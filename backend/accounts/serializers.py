from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import User


class RegisterSerializer(serializers.Serializer):
    """Input validation for POST /api/auth/register.

    SR-INPUT-01: this is the AUTHORITATIVE validation layer. Frontend checks
    are usability-only and must not be trusted.
    """

    email = serializers.EmailField()
    # min_length=2 guards against single-character or whitespace-only names
    # after stripping; max_length=255 matches the model field.
    full_name = serializers.CharField(min_length=2, max_length=255)
    # SR-AUTH-02: minimum 12 characters enforced both here (fast rejection) and
    # again via Django's AUTH_PASSWORD_VALIDATORS in validate() below.
    password = serializers.CharField(write_only=True, min_length=12)

    def validate_email(self, value):
        # Normalise: trim whitespace, lowercase domain + local part.
        return value.strip().lower()

    def validate_full_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError(
                'Full name must be at least 2 characters after trimming whitespace.'
            )
        return value

    def validate(self, attrs):
        # SR-AUTH-02: run all AUTH_PASSWORD_VALIDATORS (MinimumLength,
        # CommonPassword, NumericPassword, UserAttributeSimilarity).
        # Pass a temporary unsaved User so the similarity validator can compare
        # the password against the submitted email and full_name.
        temp_user = User(
            email=attrs.get('email', ''),
            full_name=attrs.get('full_name', ''),
        )
        try:
            validate_password(attrs['password'], user=temp_user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password': list(exc.messages)})
        return attrs


class VerifyEmailSerializer(serializers.Serializer):
    """Input validation for POST /api/auth/verify-email."""

    token = serializers.CharField(min_length=1)


class ContactSerializer(serializers.Serializer):
    """Input for POST /api/auth/contact (public landing-page contact form)."""

    name = serializers.CharField(min_length=1, max_length=150)
    email = serializers.EmailField()
    message = serializers.CharField(min_length=10, max_length=5000)

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Name must not be blank.')
        return value

    def validate_email(self, value):
        return value.strip().lower()

    def validate_message(self, value):
        value = value.strip()
        if len(value) < 10:
            raise serializers.ValidationError(
                'Message must be at least 10 characters after trimming whitespace.'
            )
        return value


class ResendVerificationSerializer(serializers.Serializer):
    """Input for POST /api/auth/resend-verification.

    Email only — the endpoint re-sends the verification link to an unverified
    account. Like password-reset, the response is identical whether or not the
    email maps to an eligible account (SR-AUTH-06 anti-enumeration).
    """

    email = serializers.EmailField()

    def validate_email(self, value):
        return value.strip().lower()


class LoginSerializer(serializers.Serializer):
    """Input validation for POST /api/auth/login.

    SR-INPUT-01: authoritative validation. No password-policy checks here —
    login must accept any string so the hash comparison always runs.
    """

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate_email(self, value):
        return value.strip().lower()


class MFAVerifySerializer(serializers.Serializer):
    """Input for POST /api/auth/mfa/verify.

    Exactly one of `code` (TOTP) or `backup_code` must be supplied.
    """

    code = serializers.CharField(required=False, min_length=6, max_length=8)
    backup_code = serializers.CharField(required=False, min_length=10, max_length=10)

    def validate(self, attrs):
        if not attrs.get('code') and not attrs.get('backup_code'):
            raise serializers.ValidationError(
                "Provide either 'code' (TOTP) or 'backup_code'."
            )
        return attrs


class PasswordResetRequestSerializer(serializers.Serializer):
    """Input for POST /api/auth/password-reset/request."""

    email = serializers.EmailField()

    def validate_email(self, value):
        return value.strip().lower()


class PasswordResetConfirmSerializer(serializers.Serializer):
    """Input for POST /api/auth/password-reset/confirm.

    SR-AUTH-02: minimum 12 characters enforced here as a fast rejection;
    the full AUTH_PASSWORD_VALIDATORS suite is run in the view where the
    user object is available (enables the similarity check).
    """

    token = serializers.CharField(min_length=1)
    new_password = serializers.CharField(write_only=True, min_length=12)


class MFAResetRequestSerializer(serializers.Serializer):
    """Input for POST /api/auth/mfa-reset/request.

    The requester proves identity with their email and password so they can ask
    for an MFA reset even if they no longer have access to the authenticator.
    """

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate_email(self, value):
        return value.strip().lower()


class MFAResetResolveSerializer(serializers.Serializer):
    """Input for POST /api/staff/mfa-reset/requests/<id>/resolve.

    Admin fallback resets must record the out-of-band verification method and
    outcome. Staff-level resets may omit those fields when no escalation is
    required.
    """

    verification_method = serializers.CharField(required=False, allow_blank=False, max_length=255)
    verification_outcome = serializers.CharField(required=False, allow_blank=False, max_length=255)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=255)


class AcceptInviteSerializer(serializers.Serializer):
    """Input for POST /api/auth/accept-invite.

    A staff member sets their initial password from an emailed invite token.
    SR-AUTH-02: minimum 12 characters enforced here as a fast rejection; the
    full AUTH_PASSWORD_VALIDATORS suite (incl. HIBP) runs in the view where the
    user object is available (enables the similarity check).
    """

    token = serializers.CharField(min_length=1)
    new_password = serializers.CharField(write_only=True, min_length=12)


class ChangePasswordSerializer(serializers.Serializer):
    """Input for POST /api/auth/change-password."""

    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=12)
