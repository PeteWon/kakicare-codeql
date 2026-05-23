import hashlib
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib import auth
from django.contrib.auth.hashers import check_password, make_password
from django.core.mail import send_mail
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from .models import EmailVerificationToken, User
from .serializers import LoginSerializer, RegisterSerializer, VerifyEmailSerializer

logger = logging.getLogger(__name__)

_TOKEN_EXPIRY_HOURS = 24
_GENERIC_VERIFY_ERROR = 'Invalid or expired verification link.'
_GENERIC_LOGIN_ERROR = 'Invalid email or password.'

# SR-AUTH-06 (timing equalizer): computed once at startup so the hash is
# available without re-deriving it per request. When an email is not found we
# still call check_password against this value so the Argon2id work happens
# regardless — prevents email-existence probing via response-time differences.
_DUMMY_PASSWORD_HASH = make_password('unused-dummy-timing-value')


def _hash_token(raw_token: str) -> str:
    # SR-DATA: only the hash is stored/queried; the raw token is never persisted.
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


# ---------------------------------------------------------------------------
# Throttle
# ---------------------------------------------------------------------------

class LoginRateThrottle(SimpleRateThrottle):
    """SR-AUTH-04: 5 login attempts per 15-minute window, keyed by source IP.

    Keying by IP (not by account email) means an attacker cannot lock out a
    legitimate user by submitting that user's email in repeated bad requests.
    """

    scope = 'login'

    def parse_rate(self, rate):
        # Return (num_requests, duration_seconds) directly; the rate string in
        # DEFAULT_THROTTLE_RATES is ignored — it exists only as documentation.
        return (5, 15 * 60)

    def get_cache_key(self, request, view):
        ident = self.get_ident(request)
        return self.cache_format % {'scope': self.scope, 'ident': ident}


# ---------------------------------------------------------------------------
# Login / logout / me
# ---------------------------------------------------------------------------

class LoginView(APIView):
    """POST /api/auth/login

    All outcomes (invalid email, wrong password, unverified, inactive, staff-
    needing-MFA) that are not a full volunteer session use a deliberate generic
    shape so callers cannot enumerate account state. The HTTP status is always
    200 — the frontend checks the `status` field in the body.
    """

    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        # Stamp the CSRF cookie on this response so the frontend can read it
        # and include X-CSRFToken on subsequent state-changing requests.
        # SR-SESS-01: the session cookie is HttpOnly (JS cannot read it); the
        # CSRF cookie is intentionally readable (HttpOnly=False, Django default)
        # so the SPA can extract and forward it as the X-CSRFToken header.
        get_token(request)

        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        email = serializer.validated_data['email']
        password = serializer.validated_data['password']

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # SR-AUTH-06 (timing equalizer): run a full Argon2id check against
            # the dummy hash so the wall-clock time matches a real wrong-password
            # attempt. Without this, a fast "email not found" response would
            # leak that the address is not registered.
            check_password(password, _DUMMY_PASSWORD_HASH)
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        # Verify the Argon2id hash (SR-AUTH-01).
        if not user.check_password(password):
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        # SR-AUTH-06: inactive and unverified accounts return the same generic
        # error as wrong-password — no information about account state is leaked.
        if not user.is_active or not user.is_email_verified:
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        if user.role == User.Role.STAFF:
            # SR-AUTH-03: credentials are verified but a full session is NOT
            # established. The user pk is stored in a short-lived session so
            # the TOTP endpoint (POST /api/auth/mfa — built in the next prompt)
            # can retrieve it and call auth.login() after code verification.
            request.session.flush()  # clear any stale session before writing
            request.session['mfa_pending_user_id'] = user.pk
            request.session.set_expiry(5 * 60)  # 5-min window to complete MFA
            return Response({'status': 'mfa_required'}, status=status.HTTP_200_OK)

        # Volunteer: establish a full authenticated session.
        # SR-SESS-01: Django's login() stores the session ID in an HttpOnly
        # cookie — the token never appears in the JSON body, preventing
        # token-in-localStorage patterns that expose credentials to XSS.
        auth.login(request, user)
        # SR-AUTH-05: 8-hour session lifetime for volunteers.
        request.session.set_expiry(8 * 3600)

        return Response(
            {'status': 'success', 'role': user.role},
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    """POST /api/auth/logout — destroys the server-side session."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        auth.logout(request)  # flushes the session and clears the cookie
        return Response({'detail': 'Logged out.'}, status=status.HTTP_200_OK)


class MeView(APIView):
    """GET /api/auth/me — returns the authenticated user's safe profile.

    Used by the frontend's ProtectedRoute to determine the current user.
    Returns 401 when not authenticated (DRF IsAuthenticated default).

    NOTE: field names here are snake_case (Django convention). When the
    frontend wires this up it will need to map full_name → fullName and
    is_email_verified → emailVerifiedAt per the TypeScript User interface.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        u = request.user
        return Response({
            'id': str(u.pk),
            'email': u.email,
            'full_name': u.full_name,
            'role': u.role,
            'is_email_verified': u.is_email_verified,
        })


# ---------------------------------------------------------------------------
# Register & email verification (unchanged)
# ---------------------------------------------------------------------------

class RegisterView(APIView):
    """POST /api/auth/register — create a volunteer account and send verification email."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data['email']
        full_name = serializer.validated_data['full_name']
        password = serializer.validated_data['password']

        # SR-AUTH-06 (anti-enumeration): never reveal whether this email is
        # already registered. Silently do nothing and return the same response.
        if not User.objects.filter(email=email).exists():
            user = User.objects.create_user(
                email=email,
                # SR-AUTH-01: hashed with Argon2id by the configured hasher.
                password=password,
                full_name=full_name,
                role=User.Role.VOLUNTEER,
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
    """POST /api/auth/verify-email — consume a single-use token and mark account verified."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'detail': _GENERIC_VERIFY_ERROR},
                status=status.HTTP_400_BAD_REQUEST,
            )

        token_hash = _hash_token(serializer.validated_data['token'])

        with transaction.atomic():
            try:
                token_obj = (
                    EmailVerificationToken.objects
                    .select_related('user')
                    .select_for_update()
                    .get(token_hash=token_hash)
                )
            except EmailVerificationToken.DoesNotExist:
                return Response(
                    {'detail': _GENERIC_VERIFY_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not token_obj.is_valid():
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
