"""Matching models: pairing a volunteer with a senior, proposed by staff."""

from django.conf import settings
from django.db import models


class Match(models.Model):
    """A volunteer<->senior pairing.

    A match is proposed by staff, accepted by the volunteer, and confirmed by
    staff after offline contact with the senior, then becomes active.
    """

    class Status(models.TextChoices):
        PROPOSED = 'proposed', 'Proposed'
        ACTIVE = 'active', 'Active'
        ENDED = 'ended', 'Ended'

    # The volunteer side is a User with role 'volunteer'. Role correctness is
    # enforced in business logic later (the FK can't constrain by role alone).
    volunteer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='matches_as_volunteer',
    )
    senior = models.ForeignKey(
        'seniors.Senior',
        on_delete=models.PROTECT,
        related_name='matches',
    )

    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PROPOSED
    )

    # Staff member who proposed the match (role 'staff').
    proposed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='proposed_matches',
    )

    volunteer_accepted_at = models.DateTimeField(null=True, blank=True)
    # Recorded by staff after they contact the senior offline to confirm.
    senior_confirmed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            # A volunteer+senior pair may have at most one match that is not
            # ended. Implemented as a partial unique index so a previously ended
            # match doesn't block re-pairing. (Postgres partial unique index.)
            models.UniqueConstraint(
                fields=['volunteer', 'senior'],
                condition=~models.Q(status='ended'),
                name='unique_active_volunteer_senior_match',
            ),
        ]

    def __str__(self):
        return f'Match(volunteer={self.volunteer_id}, senior={self.senior_id}, {self.status})'
