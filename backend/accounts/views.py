import hashlib
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EmailVerificationToken, User
from .serializers import RegisterSerializer, VerifyEmailSerializer

logger = logging.getLogger(__name__)

_TOKEN_EXPIRY_HOURS = 24
# SR-AUTH-06: single generic message used for every verification failure so
# callers cannot distinguish invalid / expired / already-used tokens.
_GENERIC_VERIFY_ERROR = 'Invalid or expired verification link.'


def _hash_token(raw_token: str) -> str:
    # SR-DATA: only this hash is stored or queried. The raw token leaves the
    # system only via the verification email and is never logged or persisted.
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


class RegisterView(APIView):
    """POST /api/auth/register

    Creates a volunteer account and emails a verification link.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data['email']
        full_name = serializer.validated_data['full_name']
        password = serializer.validated_data['password']

        # SR-AUTH-06 (anti-enumeration): if this email is already registered we
        # do NOT create a duplicate and do NOT reveal that the address exists.
        # The response is identical to the new-registration path so an attacker
        # cannot probe whether an address is in our system.
        if not User.objects.filter(email=email).exists():
            user = User.objects.create_user(
                email=email,
                # SR-AUTH-01: create_user calls set_password, which hashes with
                # Argon2id (first entry in PASSWORD_HASHERS). Raw password is
                # never stored or logged.
                password=password,
                full_name=full_name,
                role=User.Role.VOLUNTEER,
                # is_active=True so the account can log in once email is verified.
                # The email-verified check is enforced at login time (added later).
                is_active=True,
                is_email_verified=False,
            )
            _issue_and_send_verification_token(user)

        return Response(
            {'detail': 'If this email is valid, a verification link has been sent.'},
            status=status.HTTP_200_OK,
        )


def _issue_and_send_verification_token(user: User) -> None:
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = timezone.now() + timedelta(hours=_TOKEN_EXPIRY_HOURS)

    EmailVerificationToken.objects.create(
        user=user,
        token_hash=token_hash,
        expires_at=expires_at,
    )

    verify_url = f'{settings.FRONTEND_BASE_URL}/verify-email?token={raw_token}'

    send_mail(
        subject='Verify your KakiCare email address',
        message=(
            f'Hi {user.full_name},\n\n'
            f'Please verify your email address by clicking the link below.\n'
            f'The link expires in {_TOKEN_EXPIRY_HOURS} hours.\n\n'
            f'{verify_url}\n\n'
            f'If you did not register for KakiCare, you can ignore this email.'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )


class VerifyEmailView(APIView):
    """POST /api/auth/verify-email

    Consumes a single-use email verification token and marks the account verified.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        if not serializer.is_valid():
            # Malformed input is treated as an invalid token (SR-AUTH-06).
            return Response(
                {'detail': _GENERIC_VERIFY_ERROR},
                status=status.HTTP_400_BAD_REQUEST,
            )

        token_hash = _hash_token(serializer.validated_data['token'])

        # Use a transaction + SELECT FOR UPDATE to make the token single-use
        # even under concurrent requests with the same token.
        with transaction.atomic():
            try:
                token_obj = (
                    EmailVerificationToken.objects
                    .select_related('user')
                    .select_for_update()
                    .get(token_hash=token_hash)
                )
            except EmailVerificationToken.DoesNotExist:
                # SR-AUTH-06: same error for a token that never existed, has
                # expired, or has already been used — no distinction exposed.
                return Response(
                    {'detail': _GENERIC_VERIFY_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not token_obj.is_valid():
                # Covers: already used (used_at set) or expired (expires_at past).
                return Response(
                    {'detail': _GENERIC_VERIFY_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            now = timezone.now()
            token_obj.used_at = now
            token_obj.save(update_fields=['used_at'])

            user = token_obj.user
            user.is_email_verified = True
            user.save(update_fields=['is_email_verified'])

        return Response(
            {'detail': 'Email verified successfully.'},
            status=status.HTTP_200_OK,
        )
