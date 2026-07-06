"""MFA endpoints: TOTP setup/verify, status/disable, and staff-mediated reset."""

import hashlib
import hmac
import secrets
from base64 import b32encode

from django.contrib import auth
from django.contrib.auth.hashers import check_password
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import record_audit

from ..models import EncryptedTOTPDevice, MFABackupCode, MFAResetRequest, User
from ..serializers import (
    MFAResetRequestSerializer,
    MFAResetResolveSerializer,
    MFAVerifySerializer,
)
from ._common import (
    MFARateThrottle,
    MFAResetRequestRateThrottle,
    _BACKUP_CODE_COUNT,
    _DUMMY_PASSWORD_HASH,
    _GENERIC_MFA_ERROR,
    _get_ip,
)


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


def _clear_user_mfa(user: User) -> None:
    """Remove all TOTP devices and backup codes for a user."""
    EncryptedTOTPDevice.objects.filter(user=user).delete()
    user.mfa_backup_codes.all().delete()


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
# MFA reset request / resolve
# ---------------------------------------------------------------------------

class MFAResetRequestView(APIView):
    """POST /api/auth/mfa-reset/request

    A user who has lost their authenticator can verify with their password and
    create a pending MFA reset request for their own account.
    """

    permission_classes = [AllowAny]
    throttle_classes = [MFAResetRequestRateThrottle]

    # SECURITY: identical body on every outcome. The caller must NOT be able to
    # tell whether the credentials were valid — returning a success-only field
    # (e.g. request_id) would make this an account/credential enumeration oracle.
    _GENERIC_RESPONSE = {
        'detail': 'If the credentials are valid, the reset request was submitted.'
    }

    def post(self, request):
        serializer = MFAResetRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(self._GENERIC_RESPONSE, status=status.HTTP_200_OK)

        email = serializer.validated_data['email']
        password = serializer.validated_data['password']

        user = User.objects.filter(
            email=email, is_active=True, is_email_verified=True
        ).first()

        if user is None:
            # Timing equalizer (SR-AUTH-06): run Argon2id against a dummy hash so
            # a missing/inactive account is indistinguishable from a wrong
            # password — mirrors LoginView.
            check_password(password, _DUMMY_PASSWORD_HASH)
            return Response(self._GENERIC_RESPONSE, status=status.HTTP_200_OK)

        if not user.check_password(password):
            return Response(self._GENERIC_RESPONSE, status=status.HTTP_200_OK)

        request_obj = MFAResetRequest.objects.create(
            requester=user,
            target_user=user,
            reason='lost_authenticator',
        )
        record_audit(
            user=user,
            action='auth.mfa.reset.requested',
            target_type='MFAResetRequest',
            target_id=request_obj.pk,
            request_ip=_get_ip(request),
        )

        # SECURITY: do NOT include request_id (or any success-only field) — see
        # _GENERIC_RESPONSE above. Staff locate pending requests via the audit
        # log / requests queue, not from this response.
        return Response(self._GENERIC_RESPONSE, status=status.HTTP_200_OK)


class MFAResetResolveView(APIView):
    """POST /api/staff/mfa-reset/requests/<id>/resolve

    Authorisation tiering (Report 1 §10.1.2, FR-S-08): non-admin staff may only
    reset MFA for VOLUNTEER accounts. Resets for staff or superuser accounts are
    reserved for an admin (superuser) actor.

    AC-12 / SR-ADMIN-03: every reset — not just admin fallbacks — must record an
    out-of-band identity-verification method and outcome before it is executed.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk: int):
        if not (request.user.role == User.Role.STAFF):
            return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = MFAResetResolveSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            try:
                reset_request = (
                    MFAResetRequest.objects.select_related('requester', 'target_user')
                    .select_for_update()
                    .get(pk=pk)
                )
            except MFAResetRequest.DoesNotExist:
                return Response({'detail': 'Reset request not found.'}, status=status.HTTP_404_NOT_FOUND)

            if reset_request.status != MFAResetRequest.Status.PENDING:
                return Response(
                    {'detail': 'Reset request has already been resolved.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            target_user = reset_request.target_user
            is_admin_actor = bool(request.user.is_superuser)
            verification_method = serializer.validated_data.get('verification_method', '').strip()
            verification_outcome = serializer.validated_data.get('verification_outcome', '').strip()

            # §10.1.2 / FR-S-08: non-admin staff may reset volunteers only;
            # staff/superuser targets require an admin actor.
            if not is_admin_actor and target_user.role != User.Role.VOLUNTEER:
                return Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)

            # AC-12 / SR-ADMIN-03: out-of-band verification is required for every
            # MFA reset, regardless of actor or target role.
            if not verification_method or not verification_outcome:
                return Response(
                    {
                        'detail': (
                            'Out-of-band verification method and outcome are required '
                            'for MFA resets.'
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            _clear_user_mfa(target_user)
            now = timezone.now()
            reset_request.status = MFAResetRequest.Status.RESOLVED
            reset_request.reviewed_by = request.user
            reset_request.reviewed_at = now
            reset_request.resolved_at = now
            reset_request.verification_method = verification_method
            reset_request.verification_outcome = verification_outcome
            reset_request.save(
                update_fields=[
                    'status',
                    'reviewed_by',
                    'reviewed_at',
                    'resolved_at',
                    'verification_method',
                    'verification_outcome',
                ]
            )

            record_audit(
                user=request.user,
                action='auth.mfa.reset.completed',
                target_type='MFAResetRequest',
                target_id=reset_request.pk,
                metadata={
                    'verification_method': verification_method,
                    'verification_outcome': verification_outcome,
                    'target_user_role': target_user.role,
                },
                request_ip=_get_ip(request),
            )

        return Response(
            {'detail': 'MFA reset completed.'},
            status=status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# MFA status / disable (account settings)
# ---------------------------------------------------------------------------

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
