"""Serializers for the seniors app.

Two-note security contract for this file:
  SR-AUD-03: these serializers are used for WRITE (create/update) input validation
  and for READ responses returned to staff. They are intentionally NEVER passed to
  record_audit — the audit log records only the Senior's id, not its field values.
  Address, phone, and next-of-kin data must not appear in any AuditLogEntry.

  SR-AUTHZ-01: authorisation is enforced in views, not here. These serializers make
  no role checks; callers are responsible for ensuring only staff reach them.
"""

import re

from rest_framework import serializers

from .models import Senior

_VALID_DAYS = {'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'}
_VALID_BLOCKS = {'Morning', 'Afternoon', 'Evening'}

_PHONE_RE = re.compile(r'^[\d\s+\-().]+$')


class SeniorSerializer(serializers.ModelSerializer):
    created_by_email = serializers.EmailField(source='created_by.email', read_only=True)

    class Meta:
        model = Senior
        fields = [
            'id',
            'full_name',
            'address',
            'phone_number',
            'preferred_language',
            'accessibility_needs',
            'availability',
            'notes',
            'next_of_kin_name',
            'next_of_kin_contact',
            'is_active',
            'created_by_id',
            'created_by_email',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'created_by_id',
            'created_by_email',
            'created_at',
            'updated_at',
        ]

    # ── Field-level validation (SR-INPUT-01) ────────────────────────────────

    def validate_full_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Full name must not be blank.')
        if len(value) > 255:
            raise serializers.ValidationError('Full name must be at most 255 characters.')
        return value

    def validate_phone_number(self, value: str) -> str:
        value = value.strip()
        if value and not _PHONE_RE.match(value):
            raise serializers.ValidationError(
                'Phone number may only contain digits, spaces, +, -, (, ) and dots.'
            )
        if len(value) > 32:
            raise serializers.ValidationError('Phone number must be at most 32 characters.')
        return value

    def validate_preferred_language(self, value: str) -> str:
        value = value.strip()
        if len(value) > 50:
            raise serializers.ValidationError(
                'Preferred language must be at most 50 characters.'
            )
        return value

    def validate_accessibility_needs(self, value: str) -> str:
        if len(value) > 2000:
            raise serializers.ValidationError(
                'Accessibility needs must be at most 2 000 characters.'
            )
        return value

    def validate_notes(self, value: str) -> str:
        if len(value) > 5000:
            raise serializers.ValidationError('Notes must be at most 5 000 characters.')
        return value

    def validate_next_of_kin_name(self, value: str) -> str:
        value = value.strip()
        if len(value) > 255:
            raise serializers.ValidationError(
                'Next of kin name must be at most 255 characters.'
            )
        return value

    def validate_next_of_kin_contact(self, value: str) -> str:
        value = value.strip()
        if value and not _PHONE_RE.match(value):
            raise serializers.ValidationError(
                'Next of kin contact may only contain digits, spaces, +, -, (, ) and dots.'
            )
        if len(value) > 64:
            raise serializers.ValidationError(
                'Next of kin contact must be at most 64 characters.'
            )
        return value

    def validate_availability(self, value: dict) -> dict:
        if not isinstance(value, dict):
            raise serializers.ValidationError(
                'Must be an object mapping days to time blocks.'
            )
        for day, blocks in value.items():
            if day not in _VALID_DAYS:
                raise serializers.ValidationError(
                    f'Invalid day {day!r}. Must be one of: {", ".join(sorted(_VALID_DAYS))}.'
                )
            if not isinstance(blocks, list):
                raise serializers.ValidationError(f'Blocks for {day} must be a list.')
            for block in blocks:
                if block not in _VALID_BLOCKS:
                    raise serializers.ValidationError(
                        f'Invalid time block {block!r}. '
                        'Must be one of: Morning, Afternoon, Evening.'
                    )
        return value
