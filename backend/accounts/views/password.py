"""Password reset (request/confirm) and authenticated change-password."""

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib import auth
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import record_audit

from ..models import PasswordResetToken, User
from ..serializers import (
    ChangePasswordSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
)
from ._common import (
    PasswordResetRateThrottle,
    _GENERIC_RESET_ERROR,
    _PASSWORD_RESET_EXPIRY_HOURS,
    _get_ip,
    _hash_token,
    logger,
)


class PasswordResetRequestView(APIView):
    """POST /api/auth/password-reset/request"""

    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request):
        # SR-AUTH-06 (anti-enumeration): always return the same generic response
        # whether the email exists or not — callers cannot probe the user list.
        generic_ok = Response(
            {'detail': 'If this email is valid, a reset link has been sent.'},
            status=status.HTTP_200_OK,
        )

        serializer = PasswordResetRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return generic_ok

        email = serializer.validated_data['email']

        try:
            user = User.objects.get(email=email, is_active=True)
        except User.DoesNotExist:
            return generic_ok

        # Expire any outstanding reset tokens before issuing a new one,
        # so the inbox cannot accumulate multiple valid links.
        user.password_reset_tokens.filter(used_at__isnull=True).update(
            used_at=timezone.now()
        )

        raw_token = secrets.token_urlsafe(32)
        # SR-DATA: only the hash is stored; raw token goes to email only.
        token_hash = _hash_token(raw_token)
        expires_at = timezone.now() + timedelta(hours=_PASSWORD_RESET_EXPIRY_HOURS)

        PasswordResetToken.objects.create(
            user=user,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        record_audit(user=user, action='auth.password_reset.requested', request_ip=_get_ip(request))

        reset_url = f'{settings.FRONTEND_BASE_URL}/reset-password?token={raw_token}'

        # Email delivery is best-effort: a transient SMTP failure must not 500 the
        # request (and must not change the generic response, for anti-enumeration).
        try:
            send_mail(
                subject='Reset your KakiCare password',
                message=(
                    f'Hi {user.full_name},\n\n'
                    f'Click the link below to reset your password. '
                    f'The link expires in {_PASSWORD_RESET_EXPIRY_HOURS} hour(s).\n\n'
                    f'{reset_url}\n\n'
                    f'If you did not request a password reset, you can ignore this email.'
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=False,
            )
        except Exception:
            logger.exception('Failed to send password-reset email to %s', user.email)

        return generic_ok


class PasswordResetConfirmView(APIView):
    """POST /api/auth/password-reset/confirm"""

    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        raw_token = serializer.validated_data['token']
        new_password = serializer.validated_data['new_password']
        token_hash = _hash_token(raw_token)

        with transaction.atomic():
            try:
                token_obj = (
                    PasswordResetToken.objects
                    .select_related('user')
                    .select_for_update()
                    .get(token_hash=token_hash)
                )
            except PasswordResetToken.DoesNotExist:
                # SR-AUTH-06: single generic error for invalid/expired/used token.
                return Response(
                    {'detail': _GENERIC_RESET_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not token_obj.is_valid():
                return Response(
                    {'detail': _GENERIC_RESET_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user = token_obj.user

            # Validate the new password against the full policy (SR-AUTH-02),
            # including similarity check against the actual user's attributes.
            try:
                validate_password(new_password, user=user)
            except DjangoValidationError as exc:
                return Response(
                    {'new_password': list(exc.messages)},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            token_obj.used_at = timezone.now()
            token_obj.save(update_fields=['used_at'])

            # SR-AUTH-01: set_password hashes with Argon2id.
            user.set_password(new_password)
            user.save(update_fields=['password'])
            record_audit(user=user, action='auth.password_reset.completed', request_ip=_get_ip(request))

            # SR-SESS: changing the password invalidates all existing sessions.
            # Django stores a hash of the user's password (_auth_user_hash) in
            # each server-side session. When the password changes, that hash no
            # longer matches user.get_session_auth_hash(), so every open session
            # is rejected on its next request — forcing re-login everywhere.
            # This is Django's built-in session-invalidation mechanism; no manual
            # session table scan is required.

        return Response(
            {'detail': 'Password reset successfully.'},
            status=status.HTTP_200_OK,
        )


class ChangePasswordView(APIView):
    """POST /api/auth/change-password

    Authenticated users change their own password by supplying their current
    password and a new one. Changing the password invalidates all other active
    sessions via Django's built-in session auth hash mechanism.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        current_password = serializer.validated_data['current_password']
        new_password = serializer.validated_data['new_password']

        if not request.user.check_password(current_password):
            return Response(
                {'current_password': ['Incorrect password.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if current_password == new_password:
            return Response(
                {'new_password': ['New password must differ from your current password.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(new_password, user=request.user)
        except DjangoValidationError as exc:
            return Response(
                {'new_password': list(exc.messages)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        request.user.set_password(new_password)
        request.user.save(update_fields=['password'])
        record_audit(user=request.user, action='auth.password.changed', request_ip=_get_ip(request))

        # Re-authenticate so the current session remains valid after the
        # password change (other sessions are invalidated automatically).
        auth.update_session_auth_hash(request, request.user)

        return Response({'detail': 'Password changed successfully.'}, status=status.HTTP_200_OK)
