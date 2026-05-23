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


class LoginSerializer(serializers.Serializer):
    """Input validation for POST /api/auth/login.

    SR-INPUT-01: authoritative validation. No password-policy checks here —
    login must accept any string so the hash comparison always runs.
    """

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate_email(self, value):
        return value.strip().lower()
