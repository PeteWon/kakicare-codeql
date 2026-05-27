"""Serializers for the matching app.

Two serializer stacks exist for match data:
  Staff-facing  — full detail (volunteer email/name, senior full name, all timestamps).
  Volunteer-facing — limited senior info only (SR-AUTHZ-03 / JIT disclosure boundary).

SECURITY (SR-AUD-03): these serializers are used for API responses, not for
audit logging. Audit entries reference only Match ids and action names — never
the contents of a Senior or volunteer record.
"""

import re

from rest_framework import serializers

from seniors.models import Senior

from .models import Match


def _senior_locality(address: str) -> str:
    """Extract a general area name from a Singapore address.

    Strips the block/unit prefix ('Blk NNN') and the unit/postal suffix
    ('#floor-unit S(postal)') so only the street or estate name remains.
    E.g. 'Blk 123 Ang Mo Kio Ave 6 #04-12 S(560123)' → 'Ang Mo Kio Ave 6'.
    Returns an empty string if the address is blank or unparseable.
    """
    s = re.sub(r'^\s*(?:Blk|Block)?\s*\d+\s*', '', address, flags=re.I)
    s = re.sub(r'\s*#\S+.*$', '', s).strip()
    return s


class SeniorLimitedSerializer(serializers.ModelSerializer):
    """SR-AUTHZ-03 / JIT disclosure boundary — volunteer-facing senior info.

    Volunteers see ONLY: first name, preferred language, and general locality
    (area name without block, unit, or postal code). Full address, phone number,
    and next-of-kin details are disclosed just-in-time when a session is booked
    and only to the confirmed matched volunteer at that time (implemented in the
    sessions endpoint). This boundary MUST NOT be relaxed here.
    """

    first_name = serializers.SerializerMethodField()
    locality = serializers.SerializerMethodField()

    class Meta:
        model = Senior
        fields = ['id', 'first_name', 'preferred_language', 'locality']

    def get_first_name(self, obj: Senior) -> str:
        return obj.full_name.split()[0] if obj.full_name else ''

    def get_locality(self, obj: Senior) -> str:
        return _senior_locality(obj.address)


class MatchStaffSerializer(serializers.ModelSerializer):
    """Full match detail for staff — all fields including timestamps."""

    volunteer_email = serializers.EmailField(source='volunteer.email', read_only=True)
    volunteer_full_name = serializers.CharField(source='volunteer.full_name', read_only=True)
    senior_full_name = serializers.CharField(source='senior.full_name', read_only=True)
    proposed_by_email = serializers.EmailField(source='proposed_by.email', read_only=True)

    class Meta:
        model = Match
        fields = [
            'id',
            'volunteer_id',
            'volunteer_email',
            'volunteer_full_name',
            'senior_id',
            'senior_full_name',
            'status',
            'proposed_by_id',
            'proposed_by_email',
            'volunteer_accepted_at',
            'senior_confirmed_at',
            'created_at',
            'ended_at',
        ]


class MatchVolunteerSerializer(serializers.ModelSerializer):
    """Volunteer-facing match view — limited senior info only (see SeniorLimitedSerializer)."""

    senior = SeniorLimitedSerializer(read_only=True)

    class Meta:
        model = Match
        fields = [
            'id',
            'senior',
            'status',
            'volunteer_accepted_at',
            'senior_confirmed_at',
            'created_at',
        ]


class ProposeMatchSerializer(serializers.Serializer):
    """Input for POST /api/staff/matches/ — propose a new match."""

    volunteer_id = serializers.IntegerField(min_value=1)
    senior_id = serializers.IntegerField(min_value=1)
