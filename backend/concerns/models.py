"""Welfare concern model.

FR-V-14: volunteers may raise a welfare concern about a senior's wellbeing
at any point (during check-out or afterwards), linking it to a session when
available.

SECURITY (SR-AUD-03): WelfareConcern.description and resolution_note are
sensitive free-text fields. They are stored in this model and MUST NOT be
passed into AuditLogEntry (which stores references only). Audit calls carry
only target_id=concern.pk.
"""

import uuid

from django.conf import settings
from django.db import models


class WelfareConcern(models.Model):

    class Status(models.TextChoices):
        OPEN     = 'open',     'Open'
        RESOLVED = 'resolved', 'Resolved'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Always a volunteer; enforced in the view, not at DB level (role is not a
    # FK-constrainable property).
    raised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='raised_concerns',
    )

    # Nullable: concern may be raised after the session ends or without one.
    session = models.ForeignKey(
        'befriending_sessions.Session',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='welfare_concerns',
    )

    target_senior = models.ForeignKey(
        'seniors.Senior',
        on_delete=models.PROTECT,
        related_name='welfare_concerns',
    )

    description = models.TextField()

    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.OPEN,
    )

    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='resolved_concerns',
    )
    resolution_note = models.TextField(blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'WelfareConcern({self.pk}, senior={self.target_senior_id}, {self.status})'
