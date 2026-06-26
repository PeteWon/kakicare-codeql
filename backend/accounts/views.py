import hashlib
import hmac
import logging
import secrets
from base64 import b32encode
from datetime import timedelta

from django.conf import settings
from django.contrib import auth
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.middleware.csrf import get_token
from django.utils import timezone
from .models import EncryptedTOTPDevice
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from audit.services import record_audit

from .models import (
    EmailVerificationToken,
    MFABackupCode,
    PasswordResetToken,
    StaffInviteToken,
    User,
)
from .serializers import (
    AcceptInviteSerializer,
    ChangePasswordSerializer,
    LoginSerializer,
    MFAVerifySerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    VerifyEmailSerializer,
)

logger = logging.getLogger(__name__)

_TOKEN_EXPIRY_HOURS = 24
_PASSWORD_RESET_EXPIRY_HOURS = 1
_STAFF_INVITE_EXPIRY_HOURS = 72
_BACKUP_CODE_COUNT = 8

_GENERIC_VERIFY_ERROR = 'Invalid or expired verification link.'
_GENERIC_LOGIN_ERROR = 'Invalid email or password.'
_GENERIC_RESET_ERROR = 'Invalid or expired reset link.'
_GENERIC_INVITE_ERROR = 'Invalid or expired invite link.'
_GENERIC_MFA_ERROR = 'Invalid or expired code.'

# SR-AUTH-06 (timing equalizer): computed once at startup. When an email is
# not found at login we still run check_password against this value so the
# Argon2id work happens and response time does not betray email existence.
_DUMMY_PASSWORD_HASH = make_password('unused-dummy-timing-value')


def _get_ip(request) -> str | None:
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    return xff.split(',')[0].strip() if xff else request.META.get('REMOTE_ADDR')


def _hash_token(raw_token: str) -> str:
    # SR-DATA: only the hash is stored/queried; the raw token is never persisted.
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


# ---------------------------------------------------------------------------
# Throttles
# ---------------------------------------------------------------------------

class LoginRateThrottle(SimpleRateThrottle):
    """SR-AUTH-04: 5 login attempts per 15 minutes, keyed by source IP.

    IP-keyed (not account-keyed) so an attacker cannot lock out a legitimate
    user by submitting their email in repeated requests.
    """

    scope = 'login'

    def parse_rate(self, rate):
        return (5, 15 * 60)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class MFARateThrottle(SimpleRateThrottle):
    """SR-AUTH-04: 10 MFA verify attempts per 15 minutes, keyed by source IP."""

    scope = 'mfa_verify'

    def parse_rate(self, rate):
        return (10, 15 * 60)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class PasswordResetRateThrottle(SimpleRateThrottle):
    """SR-AUTH-04: 5 password-reset requests per hour, keyed by source IP."""

    scope = 'password_reset'

    def parse_rate(self, rate):
        return (5, 3600)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


# ---------------------------------------------------------------------------
# MFA helpers
# ---------------------------------------------------------------------------

def _get_mfa_context(request):
    """Return (user, is_mid_login) for MFA endpoints.

    MFA endpoints are reachable from two states:
      1. Mid-login — password verified, session holds mfa_pending_user_id,
         no full authenticated session yet.
      2. Fully authenticated — volunteer opting in after first login.

    Returns (None, False) if neither state applies.
    """
    if request.user.is_authenticated:
        return request.user, False

    user_id = request.session.get('mfa_pending_user_id')
    if not user_id:
        return None, False

    try:
        user = User.objects.get(pk=user_id, is_active=True, is_email_verified=True)
        return user, True
    except User.DoesNotExist:
        return None, False


def _generate_backup_codes(user: User) -> list:
    """Generate _BACKUP_CODE_COUNT single-use backup codes for the user.

    SECURITY: raw codes are returned here and NEVER stored — only their
    SHA-256 hashes persist. Callers must surface the raw codes to the user
    exactly once and then discard them.
    """
    raw_codes = []
    to_create = []
    for _ in range(_BACKUP_CODE_COUNT):
        raw = secrets.token_hex(5)  # 10 hex chars ≈ 40 bits of entropy
        code_hash = hashlib.sha256(raw.encode('utf-8')).hexdigest()
        to_create.append(MFABackupCode(user=user, code_hash=code_hash))
        raw_codes.append(raw)
    MFABackupCode.objects.bulk_create(to_create)
    return raw_codes


def _use_backup_code(user: User, submitted: str) -> bool:
    """Verify and consume a single-use backup code.

    Uses hmac.compare_digest for constant-time comparison so response time
    does not reveal whether the submitted code was close to valid (SR-AUTH).
    All unused codes are loaded and checked — no early exit on match — to
    keep the comparison time independent of code position.
    """
    submitted_hash = hashlib.sha256(submitted.strip().encode('utf-8')).hexdigest()

    with transaction.atomic():
        unused = list(
            user.mfa_backup_codes.filter(used_at__isnull=True).select_for_update()
        )

        matched = None
        for code in unused:
            # Check all codes without short-circuiting for constant-time behaviour.
            if hmac.compare_digest(code.code_hash, submitted_hash):
                matched = code

        if matched is None:
            return False

        matched.used_at = timezone.now()
        matched.save(update_fields=['used_at'])

    return True


# ---------------------------------------------------------------------------
# Login / logout / me
# ---------------------------------------------------------------------------

class LoginView(APIView):
    """POST /api/auth/login"""

    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        # Stamp the CSRF cookie so the frontend can send X-CSRFToken on
        # subsequent state-changing requests (logout, MFA verify, etc.).
        # SR-SESS-01: session cookie is HttpOnly; CSRF cookie is readable.
        get_token(request)

        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        email = serializer.validated_data['email']
        password = serializer.validated_data['password']

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # SR-AUTH-06 (timing equalizer): run Argon2id against a dummy hash
            # so response time is indistinguishable from a wrong-password attempt.
            check_password(password, _DUMMY_PASSWORD_HASH)
            record_audit(user=None, action='auth.login.failed', request_ip=_get_ip(request))
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        if not user.check_password(password):
            record_audit(user=user, action='auth.login.failed', request_ip=_get_ip(request))
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        # SR-AUTH-06: inactive/unverified → same generic error as wrong password.
        if not user.is_active or not user.is_email_verified:
            record_audit(user=user, action='auth.login.failed', request_ip=_get_ip(request))
            return Response({'status': 'invalid'}, status=status.HTTP_200_OK)

        # Determine MFA requirement based on role and enrolment state.
        has_confirmed_totp = EncryptedTOTPDevice.objects.devices_for_user(
            user, confirmed=True
        ).exists()

        if user.role == User.Role.STAFF:
            # SR-AUTH-03: staff ALWAYS require MFA — never issue a session here.
            request.session.flush()
            request.session['mfa_pending_user_id'] = user.pk
            if not has_confirmed_totp:
                # First login: must complete MFA setup before verify.
                request.session['mfa_needs_setup'] = True
            request.session.set_expiry(5 * 60)  # 5-min window to complete MFA
            return Response(
                {'status': 'mfa_required', 'mfa_enrolled': has_confirmed_totp},
                status=status.HTTP_200_OK,
            )

        if has_confirmed_totp:
            # Volunteer who has opted into MFA — gate behind verify.
            request.session.flush()
            request.session['mfa_pending_user_id'] = user.pk
            request.session.set_expiry(5 * 60)
            return Response(
                {'status': 'mfa_required', 'mfa_enrolled': True},
                status=status.HTTP_200_OK,
            )

        # Volunteer without MFA: establish a full session immediately.
        # SR-SESS-01: session ID in HttpOnly cookie only — never in JSON body.
        auth.login(request, user)
        request.session.set_expiry(8 * 3600)  # SR-AUTH-05: 8-hour volunteer session
        record_audit(user=user, action='auth.login.success', request_ip=_get_ip(request))

        return Response(
            {'status': 'success', 'role': user.role},
            status=status.HTTP_200_OK,
        )


class LogoutView(APIView):
    """POST /api/auth/logout"""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        record_audit(user=request.user, action='auth.logout', request_ip=_get_ip(request))
        auth.logout(request)
        return Response({'detail': 'Logged out.'}, status=status.HTTP_200_OK)


class MeView(APIView):
    """GET /api/auth/me

    Returns the current user's safe profile. 401 when not authenticated.
    Used by the frontend's ProtectedRoute.

    NOTE: snake_case field names here; frontend will map full_name → fullName
    and is_email_verified → emailVerifiedAt when wiring up.
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
# MFA — setup and verify
# ---------------------------------------------------------------------------

class MFASetupView(APIView):
    """POST /api/auth/mfa/setup

    Creates an unconfirmed TOTP device and returns the provisioning URI plus
    one-time backup codes. Accessible during mid-login (for staff on first
    login) and for fully authenticated users opting in.

    Calling setup again clears any previous unconfirmed device and regenerates
    codes, making re-enrolment safe and idempotent.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        user, is_mid_login = _get_mfa_context(request)
        if user is None:
            return Response(
                {'detail': 'Authentication required.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # Clear any prior in-progress setup (unconfirmed device + unused backup
        # codes). Confirmed devices are NOT removed here — they remain valid
        # until a new device is confirmed, so the user never loses MFA access
        # mid-setup if they restart the flow.
        EncryptedTOTPDevice.objects.filter(user=user, confirmed=False).delete()
        # Backup codes belong to the user, not a specific device. Wiping them on
        # every setup call would strand a user who already has a confirmed device
        # and valid codes if they bail mid-flow. Only clear when no confirmed
        # device exists — i.e. any existing codes are leftovers from an abandoned
        # initial setup, never delivered to the user.
        has_confirmed_device = EncryptedTOTPDevice.objects.devices_for_user(
            user, confirmed=True
        ).exists()
        if not has_confirmed_device:
            user.mfa_backup_codes.all().delete()

        device = EncryptedTOTPDevice.objects.create(
            user=user,
            name=f'totp-{user.pk}',
            confirmed=False,
        )

        # SECURITY: backup codes are returned exactly once here and never stored.
        # The user must save them before closing this screen.
        raw_codes = _generate_backup_codes(user)

        return Response({
            'config_url': device.config_url,       # otpauth:// URI for QR code
            'secret_key': b32encode(device.bin_key).decode('ascii'),  # manual entry
            'backup_codes': raw_codes,
        })


class MFAVerifyView(APIView):
    """POST /api/auth/mfa/verify

    Accepts a TOTP code or a backup code.

    Mid-login (staff or volunteer with MFA): on success establishes a full
    authenticated session.
    Post-login enrolment (volunteer opting in): on success marks the device
    confirmed.
    """

    permission_classes = [AllowAny]
    throttle_classes = [MFARateThrottle]

    def post(self, request):
        user, is_mid_login = _get_mfa_context(request)
        if user is None:
            return Response(
                {'detail': 'Authentication required.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        serializer = MFAVerifySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(
                {'detail': _GENERIC_MFA_ERROR},
                status=status.HTTP_400_BAD_REQUEST,
            )

        totp_code = serializer.validated_data.get('code', '').strip()
        backup_code = serializer.validated_data.get('backup_code', '').strip()

        # Determine which device to verify against.
        # Mid-login: prefer confirmed device (returning user); fall back to
        # unconfirmed (staff completing first-login setup).
        # Post-login enrolment: prefer unconfirmed device (being confirmed now).
        if is_mid_login:
            device = (
                EncryptedTOTPDevice.objects.devices_for_user(user, confirmed=True).first()
                or EncryptedTOTPDevice.objects.filter(user=user, confirmed=False).first()
            )
        else:
            device = (
                EncryptedTOTPDevice.objects.filter(user=user, confirmed=False).first()
                or EncryptedTOTPDevice.objects.devices_for_user(user, confirmed=True).first()
            )

        if device is None and not backup_code:
            return Response(
                {'detail': 'No MFA device found. Complete setup first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        confirming_new_device = device is not None and not device.confirmed

        # --- Verify ---
        verified = False

        if totp_code and device is not None:
            # verify_token handles time-window drift and updates last_t to
            # prevent replay. ThrottlingMixin adds per-device back-off on
            # repeated failures (separate from the IP-based DRF throttle above).
            verified = device.verify_token(totp_code)

        if not verified and backup_code:
            verified = _use_backup_code(user, backup_code)
            if verified:
                # Backup code used — skip device confirmation flow below since
                # the backup code works regardless of device confirmed state.
                confirming_new_device = False

        if not verified:
            record_audit(user=user, action='auth.mfa.verify_failed', request_ip=_get_ip(request))
            return Response(
                {'detail': _GENERIC_MFA_ERROR},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # --- Success ---
        if confirming_new_device:
            # Completing enrolment: promote the device from unconfirmed to active.
            device.confirmed = True
            device.save(update_fields=['confirmed'])
            record_audit(user=user, action='auth.mfa.enrolled', request_ip=_get_ip(request))

        if is_mid_login:
            # SR-AUTH-03: NOW establish the full authenticated session, after
            # both password and TOTP have been verified.
            auth.login(request, user)
            # SR-AUTH-05: 1-hour session for staff, 8-hour for volunteers.
            expiry = 3600 if user.role == User.Role.STAFF else 8 * 3600
            request.session.set_expiry(expiry)
            record_audit(user=user, action='auth.login.success', request_ip=_get_ip(request))
            return Response(
                {'status': 'success', 'role': user.role},
                status=status.HTTP_200_OK,
            )

        # Post-login enrolment complete.
        return Response({'status': 'enrolled'}, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------

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
        )

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


# ---------------------------------------------------------------------------
# Register & email verification (unchanged)
# ---------------------------------------------------------------------------

class RegisterView(APIView):
    """POST /api/auth/register"""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        email = serializer.validated_data['email']
        full_name = serializer.validated_data['full_name']
        password = serializer.validated_data['password']

        # SR-AUTH-06: same response whether email exists or not.
        if not User.objects.filter(email=email).exists():
            user = User.objects.create_user(
                email=email,
                password=password,  # SR-AUTH-01: hashed with Argon2id
                full_name=full_name,
                role=User.Role.VOLUNTEER,
                is_active=True,
                is_email_verified=False,
            )
            _issue_and_send_verification_token(user)
            record_audit(user=user, action='auth.register', request_ip=_get_ip(request))

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


def issue_and_send_staff_invite(user: User) -> None:
    """Issue a single-use invite token and email the staff member a set-password link.

    Called when an admin provisions a staff account in the Django portal. Any
    outstanding invites are expired first so only one link is ever live (also
    makes this safe to call again as a 'resend'). Public (not underscored) so the
    admin (admin.py) can call it.
    """
    # Expire any outstanding invites before issuing a new one.
    user.staff_invite_tokens.filter(used_at__isnull=True).update(
        used_at=timezone.now()
    )

    raw_token = secrets.token_urlsafe(32)
    # SR-DATA: only the hash is stored; the raw token goes to email only.
    token_hash = _hash_token(raw_token)
    expires_at = timezone.now() + timedelta(hours=_STAFF_INVITE_EXPIRY_HOURS)

    StaffInviteToken.objects.create(
        user=user,
        token_hash=token_hash,
        expires_at=expires_at,
    )

    # Public path (not under /staff, which is auth-gated) — the invitee is not
    # logged in yet when they click this link.
    invite_url = f'{settings.FRONTEND_BASE_URL}/accept-invite?token={raw_token}'

    send_mail(
        subject='You have been invited to KakiCare',
        message=(
            f'Hi {user.full_name},\n\n'
            f'A KakiCare administrator has created a staff account for you. '
            f'Click the link below to set your password and activate your account. '
            f'The link expires in {_STAFF_INVITE_EXPIRY_HOURS} hours.\n\n'
            f'{invite_url}\n\n'
            f'If you were not expecting this invitation, you can ignore this email.'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )


class AcceptInviteView(APIView):
    """POST /api/auth/accept-invite

    A staff member sets their initial password from an emailed invite token.
    On success the account is activated and marked email-verified (clicking the
    link proves control of the inbox). First login then forces TOTP enrolment.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = AcceptInviteSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        raw_token = serializer.validated_data['token']
        new_password = serializer.validated_data['new_password']
        token_hash = _hash_token(raw_token)

        with transaction.atomic():
            try:
                token_obj = (
                    StaffInviteToken.objects
                    .select_related('user')
                    .select_for_update()
                    .get(token_hash=token_hash)
                )
            except StaffInviteToken.DoesNotExist:
                # SR-AUTH-06: single generic error for invalid/expired/used token.
                return Response(
                    {'detail': _GENERIC_INVITE_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not token_obj.is_valid():
                return Response(
                    {'detail': _GENERIC_INVITE_ERROR},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user = token_obj.user

            # Validate against the full policy (SR-AUTH-02), incl. HIBP and the
            # similarity check against this user's email/name.
            try:
                validate_password(new_password, user=user)
            except DjangoValidationError as exc:
                return Response(
                    {'new_password': list(exc.messages)},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            token_obj.used_at = timezone.now()
            token_obj.save(update_fields=['used_at'])

            # SR-AUTH-01: set_password hashes with Argon2id. Activate the account
            # and mark email verified — clicking the link proves inbox control.
            user.set_password(new_password)
            user.is_active = True
            user.is_email_verified = True
            user.save(update_fields=['password', 'is_active', 'is_email_verified'])
            record_audit(user=user, action='auth.staff_invite.accepted', request_ip=_get_ip(request))

        return Response(
            {'detail': 'Password set successfully. You can now log in.'},
            status=status.HTTP_200_OK,
        )


class VerifyEmailView(APIView):
    """POST /api/auth/verify-email"""

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
            record_audit(user=user, action='auth.email.verified', request_ip=_get_ip(request))

        return Response(
            {'detail': 'Email verified successfully.'},
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# Account settings
# ---------------------------------------------------------------------------

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


class MFAStatusView(APIView):
    """GET /api/auth/mfa/status

    Returns whether the authenticated user has a confirmed TOTP device enrolled.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        enrolled = EncryptedTOTPDevice.objects.filter(
            user=request.user, confirmed=True
        ).exists()
        return Response({'enrolled': enrolled})


class MFADisableView(APIView):
    """POST /api/auth/mfa/disable

    Allows volunteers to disable MFA by removing their confirmed TOTP device
    and backup codes. Staff MFA is mandatory and cannot be disabled here.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if request.user.role == User.Role.STAFF:
            return Response(
                {'detail': 'MFA cannot be disabled for staff accounts.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        EncryptedTOTPDevice.objects.filter(user=request.user).delete()
        request.user.mfa_backup_codes.all().delete()
        record_audit(user=request.user, action='auth.mfa.disabled', request_ip=_get_ip(request))

        return Response({'detail': 'MFA disabled successfully.'}, status=status.HTTP_200_OK)
