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

from accounts.models import GlobalConfiguration

from .models import Session


def _jit_window_open(session: Session) -> bool:
    """Return True if the JIT disclosure window is currently open.

    SR-AUTHZ-03: computed fresh from server clock on every call; not a stored
    flag and cannot be influenced by any client-supplied value.

    FR-A-03/SR-ADMIN-02: the "before" window is admin-configurable via the
    GlobalConfiguration singleton (in minutes). If it is unset or unreadable,
    fall back to the SESSION_DISCLOSURE_BEFORE setting (hours) so disclosure
    logic degrades safely rather than erroring on the read path.
    """
    default_before = timedelta(hours=getattr(settings, 'SESSION_DISCLOSURE_BEFORE', 2))
    try:
        config = GlobalConfiguration.objects.first()
        before_delta = (
            timedelta(minutes=config.jit_disclosure_window_minutes)
            if config else default_before
        )
    except Exception:
        # Defensive: never let a config read failure break senior disclosure.
        before_delta = default_before

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

    # Befriending sessions may only run within local business hours. Kept in
    # sync with the client-side window in BookSession.tsx (9am-6pm SGT). This is
    # the authoritative check — the client validation is usability only.
    BUSINESS_START_HOUR = 9
    BUSINESS_END_HOUR = 18

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
        # Enforce the local business-hours window. Convert to local time (SGT,
        # per settings.TIME_ZONE) before checking the hour so the window means
        # the same thing regardless of the UTC offset in the submitted value.
        start_local = timezone.localtime(data['scheduled_start'])
        end_local = timezone.localtime(data['scheduled_end'])
        if not (self.BUSINESS_START_HOUR <= start_local.hour < self.BUSINESS_END_HOUR
                or (start_local.hour == self.BUSINESS_END_HOUR and start_local.minute == 0)):
            raise serializers.ValidationError(
                {'scheduled_start': 'Sessions must start between 9:00 AM and 6:00 PM.'}
            )
        end_after_close = (
            end_local.hour > self.BUSINESS_END_HOUR
            or (end_local.hour == self.BUSINESS_END_HOUR and end_local.minute > 0)
        )
        if end_local.hour < self.BUSINESS_START_HOUR or end_after_close:
            raise serializers.ValidationError(
                {'scheduled_end': 'Sessions must end between 9:00 AM and 6:00 PM.'}
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
