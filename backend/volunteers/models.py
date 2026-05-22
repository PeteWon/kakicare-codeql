"""Volunteer models: the application profile and uploaded documents.

`availability` uses the same structured JSON shape as seniors (see seniors app):
a mapping of weekday -> list of time blocks, e.g.
    {"Mon": ["Morning", "Evening"], "Sat": ["Afternoon"]}
Days: Mon..Sun. Blocks: Morning | Afternoon | Evening. Kept as JSON so the shape
is flexible; queryable via Postgres JSONB operators where needed.
"""

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models


class VolunteerProfile(models.Model):
    """Extended profile for a volunteer account, vetted by staff."""

    class ApplicationStatus(models.TextChoices):
        INCOMPLETE = 'incomplete', 'Incomplete'
        PENDING_REVIEW = 'pending_review', 'Pending review'
        CHANGES_REQUESTED = 'changes_requested', 'Changes requested'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='volunteer_profile',
    )
    contact_number = models.CharField(max_length=32, blank=True)

    # Stored as Postgres arrays so they remain queryable (e.g. filter volunteers
    # who speak a given language or cover a given area).
    languages = ArrayField(models.CharField(max_length=50), default=list, blank=True)
    travel_areas = ArrayField(models.CharField(max_length=50), default=list, blank=True)

    # Structured availability (see module docstring for shape).
    availability = models.JSONField(default=dict, blank=True)

    about_text = models.TextField(blank=True)

    application_status = models.CharField(
        max_length=20,
        choices=ApplicationStatus.choices,
        default=ApplicationStatus.INCOMPLETE,
    )

    # Staff member who reviewed this application (role 'staff').
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_volunteer_profiles',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    # SECURITY: staff-only internal note about the review. This MUST NEVER be
    # exposed to the volunteer through any serializer or API response — it is
    # for internal staff use only.
    internal_review_note = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'VolunteerProfile(user={self.user_id}, {self.application_status})'


class VolunteerDocument(models.Model):
    """An identity or declaration document uploaded by a volunteer.

    SECURITY (SR-DATA-03): the stored file MUST live OUTSIDE the web root and be
    served only via an authenticated, authorised endpoint — never linked
    directly or served by the web server. MEDIA_ROOT is configured to a private
    directory for this reason.

    SECURITY (SR-DATA-04, abuse case AC-10): the backend MUST validate the REAL
    content type by inspecting the file's bytes (magic numbers), NOT by trusting
    the client-supplied extension or `content_type`. The `content_type` /
    `original_filename` fields below are client-reported metadata and are
    therefore UNTRUSTED — store them for reference/display only.
    """

    class DocumentType(models.TextChoices):
        IDENTITY = 'identity', 'Identity document'
        DECLARATION = 'declaration', 'Declaration form'

    profile = models.ForeignKey(
        VolunteerProfile, on_delete=models.CASCADE, related_name='documents'
    )
    document_type = models.CharField(max_length=20, choices=DocumentType.choices)

    # Stored under the private MEDIA_ROOT (outside the web root).
    file = models.FileField(upload_to='volunteer_documents/')

    # Client-reported metadata — UNTRUSTED (see class docstring). Do not rely on
    # these for access/validation decisions.
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)

    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'VolunteerDocument(profile={self.profile_id}, {self.document_type})'
