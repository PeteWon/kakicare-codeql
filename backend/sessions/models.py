"""Befriending session models (visits and calls under a match).

NOTE: this app's label is 'befriending_sessions' (set in apps.py) to avoid
clashing with Django's built-in django.contrib.sessions.
"""

from django.conf import settings
from django.db import models


class Session(models.Model):
    """A scheduled befriending interaction (visit or call) under a match."""

    class SessionType(models.TextChoices):
        VISIT = 'visit', 'Visit'
        CALL = 'call', 'Call'

    class Status(models.TextChoices):
        PENDING_CONFIRMATION = 'pending_confirmation', 'Pending confirmation'
        CONFIRMED = 'confirmed', 'Confirmed'
        IN_PROGRESS = 'in_progress', 'In progress'
        COMPLETED = 'completed', 'Completed'
        MISSED = 'missed', 'Missed'
        CANCELLED = 'cancelled', 'Cancelled'

    class FollowUpOutcome(models.TextChoices):
        SENIOR_WELL = 'senior_well', 'Senior is well'
        RESCHEDULED = 'rescheduled', 'Session rescheduled'
        ESCALATED = 'escalated', 'Welfare concern escalated'

    match = models.ForeignKey(
        'matching.Match', on_delete=models.CASCADE, related_name='sessions'
    )
    session_type = models.CharField(max_length=10, choices=SessionType.choices)

    scheduled_start = models.DateTimeField()
    scheduled_end = models.DateTimeField()

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING_CONFIRMATION
    )

    # SECURITY (abuse case AC-04): single-use check-in code. Only the HASH of the
    # code is stored — never the plaintext. The raw code is shown to the
    # volunteer once and verified by hashing the presented value and comparing.
    checkin_code_hash = models.CharField(max_length=128, blank=True)

    checkin_at = models.DateTimeField(null=True, blank=True)
    checkout_at = models.DateTimeField(null=True, blank=True)

    volunteer_note = models.TextField(null=True, blank=True)

    # Staff member who confirmed the session (role 'staff').
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='confirmed_sessions',
    )

    # SECURITY (SR-AUTHZ-03): the just-in-time disclosure window — when a
    # volunteer may view the senior's sensitive details for this session
    # (default: from 2h before scheduled_start to 1h after scheduled_end) — is
    # COMPUTED from scheduled_start/scheduled_end and enforced server-side in the
    # permission/serializer layer later. It is deliberately NOT stored as a flag
    # here, so the window can't drift out of sync or be toggled directly.

    cancel_reason = models.TextField(blank=True)

    followup_outcome = models.CharField(
        max_length=20, choices=FollowUpOutcome.choices, blank=True
    )
    followup_note = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Session(match={self.match_id}, {self.session_type}, {self.status})'
