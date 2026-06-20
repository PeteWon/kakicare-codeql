"""Senior records — managed by staff; seniors never log in.

PLANNED HARDENING (SR-DATA-05): several fields on Senior hold sensitive personal
data (home address, phone number, next-of-kin name and contact). For v1 these
are stored as plain columns to keep the model simple, but APPLICATION-LAYER
ENCRYPTION of these fields is a planned hardening step before deployment: values
will be encrypted in the application before being written to the database and
decrypted on read, so the raw values are not exposed in a database dump. Each
such field is flagged with a `# TODO(security)` comment below. Encryption is NOT
implemented now.

`availability` uses the same structured JSON shape as volunteers: a mapping of
weekday -> list of time blocks, e.g. {"Mon": ["Morning"], "Wed": ["Afternoon"]}.
"""

from django.conf import settings
from django.db import models


class Senior(models.Model):
    """An elderly participant in the befriending programme."""

    full_name = models.CharField(max_length=255)

    # TODO(security): encrypt at application layer before deployment (SR-DATA-05)
    address = models.TextField(blank=True)
    # TODO(security): encrypt at application layer before deployment (SR-DATA-05)
    phone_number = models.CharField(max_length=32, blank=True)

    preferred_language = models.CharField(max_length=50, blank=True)
    accessibility_needs = models.TextField(blank=True)

    # Structured availability (see module docstring for shape).
    availability = models.JSONField(default=dict, blank=True)

    notes = models.TextField(blank=True)

    # TODO(security): encrypt at application layer before deployment (SR-DATA-05)
    next_of_kin_name = models.CharField(max_length=255, blank=True)
    # TODO(security): encrypt at application layer before deployment (SR-DATA-05)
    next_of_kin_contact = models.CharField(max_length=64, blank=True)

    is_active = models.BooleanField(default=True)

    # Staff member who created this record (role 'staff').
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='created_seniors',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Senior({self.full_name})'
