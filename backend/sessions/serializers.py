"""Sessions serializers.

SR-AUTHZ-03 (JIT disclosure): SessionVolunteerSerializer exposes either
limited or full senior contact details depending on whether the server clock
falls within the computed disclosure window. This is never a stored flag.
"""

import re
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .models import Session
from accounts.models import GlobalConfiguration  


def _jit_window_open(session: Session) -> bool:
    """Return True if the JIT disclosure window is currently open.

    SR-AUTHZ-03: computed fresh from server clock on every call; not a stored
    flag and cannot be influenced by any client-supplied value.
    """

    try:
        config = GlobalConfiguration.objects.first()
        if config:
            # Enforce dynamic setting in minutes
            before_delta = timedelta(minutes=config.jit_disclosure_window_minutes)
        else:
         
            before_delta = timedelta(hours=getattr(settings, 'SESSION_DISCLOSURE_BEFORE', 2))
    except Exception:
  
        before_delta = timedelta(hours=getattr(settings, 'SESSION_DISCLOSURE_BEFORE', 2))

    after = getattr(settings, 'SESSION_DISCLOSURE_AFTER', 1)
    now = timezone.now()
    
    return (
        session.scheduled_start - before_delta
        <= now <=
        session.scheduled_end + timedelta(hours=after)
    )

def _senior_locality(address: str) -> str:
    s = re.sub(r'^\s*(?:Blk|Block)?\s*\d+\s*', '', address, flags=re.I)
    s = re.sub(r'\s*#\S+', '', s).strip()
    return s


class SessionVolunteerSerializer(serializers.ModelSerializer):
    """Volunteer-facing session output.

    SR-AUTHZ-03: the `senior` field returns limited info (first name,
    language, locality) outside the JIT window, and full contact details
    (address, phone, NOK) inside it. The window is computed server-side on
    every request — never stored or influenced by the client.
    """

    senior = serializers.SerializerMethodField()
    jit_disclosure_active = serializers.SerializerMethodField()

    class Meta:
        model = Session
        fields = [
            'id', 'session_type', 'scheduled_start', 'scheduled_end',
            'status', 'checkin_at', 'checkout_at', 'volunteer_note',
            'jit_disclosure_active', 'senior', 'created_at',
        ]

    def get_jit_disclosure_active(self, obj):
        return _jit_window_open(obj)

    def get_senior(self, obj):
        senior = obj.match.senior
        if _jit_window_open(obj):
            return {
                'id': senior.pk,
                'full_name': senior.full_name,
                'address': senior.address,
                'phone_number': senior.phone_number,
                'preferred_language': senior.preferred_language,
                'next_of_kin_name': senior.next_of_kin_name,
                'next_of_kin_contact': senior.next_of_kin_contact,
            }
        return {
            'id': senior.pk,
            'first_name': senior.full_name.split()[0] if senior.full_name else '',
            'preferred_language': senior.preferred_language,
            'locality': _senior_locality(senior.address),
        }


class SessionStaffSerializer(serializers.ModelSerializer):
    """Staff-facing full session output — all fields, full senior details."""

    senior = serializers.SerializerMethodField()
    volunteer = serializers.SerializerMethodField()
    match_id = serializers.IntegerField(source='match.id', read_only=True)

    class Meta:
        model = Session
        fields = [
            'id', 'match_id', 'session_type', 'scheduled_start', 'scheduled_end',
            'status', 'checkin_at', 'checkout_at', 'volunteer_note',
            'confirmed_by_id', 'cancel_reason', 'followup_outcome', 'followup_note',
            'senior', 'volunteer', 'created_at',
        ]

    def get_senior(self, obj):
        s = obj.match.senior
        return {
            'id': s.pk,
            'full_name': s.full_name,
            'address': s.address,
            'phone_number': s.phone_number,
            'preferred_language': s.preferred_language,
            'next_of_kin_name': s.next_of_kin_name,
            'next_of_kin_contact': s.next_of_kin_contact,
        }

    def get_volunteer(self, obj):
        v = obj.match.volunteer
        return {'id': v.pk, 'full_name': v.full_name, 'email': v.email}


class SessionBookSerializer(serializers.Serializer):
    """Input: volunteer books a new session."""

    match_id = serializers.IntegerField()
    session_type = serializers.ChoiceField(choices=Session.SessionType.choices)
    scheduled_start = serializers.DateTimeField()
    scheduled_end = serializers.DateTimeField()

    def validate(self, data):
        if data['scheduled_end'] <= data['scheduled_start']:
            raise serializers.ValidationError(
                {'scheduled_end': 'Must be after scheduled_start.'}
            )
        if data['scheduled_start'] <= timezone.now():
            raise serializers.ValidationError(
                {'scheduled_start': 'Must be in the future.'}
            )
        return data


class CheckInSerializer(serializers.Serializer):
    code = serializers.CharField(min_length=6, max_length=6)


class CheckOutSerializer(serializers.Serializer):
    volunteer_note = serializers.CharField(required=False, allow_blank=True, default='')


class SessionCancelSerializer(serializers.Serializer):
    cancel_reason = serializers.CharField(max_length=500)


class SessionFollowUpSerializer(serializers.Serializer):
    followup_outcome = serializers.ChoiceField(choices=Session.FollowUpOutcome.choices)
    followup_note = serializers.CharField(required=False, allow_blank=True, default='')
