"""Senior records — managed by staff; seniors never log in.

SR-DATA-05 (implemented): several fields on Senior hold sensitive personal data
(home address, phone number, next-of-kin name and contact). These are encrypted
at the application layer via EncryptedTextField (Fernet, see seniors/fields.py):
values are encrypted before being written to the database and decrypted on read,
so the raw values are not exposed in a database dump. Encryption is transparent
to serializers, views and the admin — they read/write plaintext as normal.
Consequence: encrypted columns are not substring-searchable, so the senior
search matches on full_name only (see seniors/views.py).

`availability` uses the same structured JSON shape as volunteers: a mapping of
weekday -> list of time blocks, e.g. {"Mon": ["Morning"], "Wed": ["Afternoon"]}.
"""

from django.conf import settings
from django.db import models

from .fields import EncryptedTextField


class Senior(models.Model):
    """An elderly participant in the befriending programme."""

    class ConsentStatus(models.TextChoices):
        NOT_RECORDED = 'not_recorded', 'Not Recorded'
        GIVEN        = 'given',        'Given'
        WITHDRAWN    = 'withdrawn',    'Withdrawn'

    full_name = models.CharField(max_length=255)

    # SR-DATA-05: encrypted at rest (input length validated in the serializer).
    address = EncryptedTextField(blank=True)
    # SR-DATA-05: encrypted at rest.
    phone_number = EncryptedTextField(blank=True)

    preferred_language = models.CharField(max_length=50, blank=True)
    accessibility_needs = models.TextField(blank=True)

    # Structured availability (see module docstring for shape).
    availability = models.JSONField(default=dict, blank=True)

    notes = models.TextField(blank=True)

    # SR-DATA-05: encrypted at rest.
    next_of_kin_name = EncryptedTextField(blank=True)
    # SR-DATA-05: encrypted at rest.
    next_of_kin_contact = EncryptedTextField(blank=True)

    # FR-S-13 / SR-S-13: consent must be recorded before a senior can be matched
    # or have sessions scheduled. Defaults to not_recorded so existing records
    # are not silently assumed to have consent.
    consent_status = models.CharField(
        max_length=20,
        choices=ConsentStatus.choices,
        default=ConsentStatus.NOT_RECORDED,
    )

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
