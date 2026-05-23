"""Serializers for the volunteers app.

Two distinct serializer stacks exist for the same underlying data:

  Volunteer-facing  — read/write access to own profile; NEVER exposes
                      internal_review_note, reviewed_by, reviewed_at.
  Staff-facing      — full read access including the internal note.

Keeping them separate (rather than toggling fields via context) makes it
impossible to accidentally expose a staff-only field by forgetting a conditional.

SECURITY (SR-AUTHZ-02): volunteers see only their own data; staff see all.
That ownership check is enforced in views, not here.
"""

from rest_framework import serializers

from .models import VolunteerDocument, VolunteerProfile

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

_VALID_DAYS = {'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'}
_VALID_BLOCKS = {'Morning', 'Afternoon', 'Evening'}


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

class VolunteerDocumentInfoSerializer(serializers.ModelSerializer):
    """Safe representation of a document record.

    SECURITY: the physical file path (the `file` field) is intentionally
    excluded — never expose the server-side storage path to any client.
    Use the `download_url` to serve file content via the authorised endpoint.
    """

    download_url = serializers.SerializerMethodField()

    class Meta:
        model = VolunteerDocument
        fields = [
            'id',
            'document_type',
            'original_filename',
            'content_type',   # server-detected MIME type (not client-supplied)
            'uploaded_at',
            'download_url',
        ]

    def get_download_url(self, obj: VolunteerDocument) -> str:
        return f'/api/volunteer/documents/{obj.pk}/download'


# ---------------------------------------------------------------------------
# Volunteer-facing serializers
# ---------------------------------------------------------------------------

class VolunteerProfileSerializer(serializers.ModelSerializer):
    """Volunteer's own profile — read/write.

    SECURITY: internal_review_note, reviewed_by, and reviewed_at are
    intentionally EXCLUDED. Those are staff-only fields and must never be
    exposed to the volunteer through any response, even read-only.

    `application_status` is read-only here — volunteers cannot set their own
    status. Status transitions are managed by view logic and the document
    upload endpoint.
    """

    documents = VolunteerDocumentInfoSerializer(many=True, read_only=True)

    class Meta:
        model = VolunteerProfile
        fields = [
            'id',
            'contact_number',
            'languages',
            'travel_areas',
            'availability',
            'about_text',
            'application_status',
            'created_at',
            'updated_at',
            'documents',
        ]
        read_only_fields = ['id', 'application_status', 'created_at', 'updated_at']

    # ── Field-level validation (SR-INPUT-01) ─────────────────────────────

    def validate_contact_number(self, value: str) -> str:
        value = value.strip()
        if len(value) > 32:
            raise serializers.ValidationError('Contact number must be at most 32 characters.')
        return value

    def validate_languages(self, value: list) -> list:
        if not isinstance(value, list):
            raise serializers.ValidationError('Must be a list of strings.')
        cleaned = []
        for item in value:
            if not isinstance(item, str):
                raise serializers.ValidationError('Each entry must be a string.')
            item = item.strip()
            if not item:
                raise serializers.ValidationError('Language entries must not be blank.')
            if len(item) > 50:
                raise serializers.ValidationError('Each language must be at most 50 characters.')
            cleaned.append(item)
        return cleaned

    def validate_travel_areas(self, value: list) -> list:
        if not isinstance(value, list):
            raise serializers.ValidationError('Must be a list of strings.')
        cleaned = []
        for item in value:
            if not isinstance(item, str):
                raise serializers.ValidationError('Each entry must be a string.')
            item = item.strip()
            if not item:
                raise serializers.ValidationError('Area entries must not be blank.')
            if len(item) > 50:
                raise serializers.ValidationError('Each area must be at most 50 characters.')
            cleaned.append(item)
        return cleaned

    def validate_availability(self, value: dict) -> dict:
        if not isinstance(value, dict):
            raise serializers.ValidationError('Must be an object mapping days to time blocks.')
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
                        f'Invalid time block {block!r}. Must be one of: Morning, Afternoon, Evening.'
                    )
        return value

    def validate_about_text(self, value: str) -> str:
        if len(value) > 2000:
            raise serializers.ValidationError('About text must be at most 2 000 characters.')
        return value


# ---------------------------------------------------------------------------
# Staff-facing serializers
# ---------------------------------------------------------------------------

class StaffApplicationListSerializer(serializers.ModelSerializer):
    """Lightweight application summary for the paginated list view.

    Documents are omitted here to keep list queries fast; they appear in the
    detail view (StaffApplicationDetailSerializer).
    """

    user_email = serializers.EmailField(source='user.email', read_only=True)
    user_full_name = serializers.CharField(source='user.full_name', read_only=True)

    class Meta:
        model = VolunteerProfile
        fields = [
            'id',
            'user_id',
            'user_email',
            'user_full_name',
            'contact_number',
            'languages',
            'travel_areas',
            'application_status',
            'reviewed_at',
            'created_at',
            'updated_at',
        ]


class StaffApplicationDetailSerializer(serializers.ModelSerializer):
    """Full application detail for staff — includes internal note and documents."""

    user_email = serializers.EmailField(source='user.email', read_only=True)
    user_full_name = serializers.CharField(source='user.full_name', read_only=True)
    reviewed_by_email = serializers.EmailField(
        source='reviewed_by.email', read_only=True, allow_null=True
    )
    documents = VolunteerDocumentInfoSerializer(many=True, read_only=True)

    class Meta:
        model = VolunteerProfile
        fields = [
            'id',
            'user_id',
            'user_email',
            'user_full_name',
            'contact_number',
            'languages',
            'travel_areas',
            'availability',
            'about_text',
            'application_status',
            'internal_review_note',   # staff-only: NEVER include in volunteer serializers
            'reviewed_by_id',
            'reviewed_by_email',
            'reviewed_at',
            'created_at',
            'updated_at',
            'documents',
        ]


# ---------------------------------------------------------------------------
# Input serializers
# ---------------------------------------------------------------------------

class DocumentUploadSerializer(serializers.Serializer):
    """Validates the non-file fields of a document upload.

    SECURITY (SR-INPUT-01, AC-10): client-supplied file type and size are
    usability hints only and are NOT trusted here. File content is validated
    server-side by inspecting magic bytes in the view.
    """

    document_type = serializers.ChoiceField(
        choices=VolunteerDocument.DocumentType.choices,
        error_messages={'invalid_choice': 'Must be "identity" or "declaration".'},
    )


_DECISION_CHOICES = ['approve', 'reject', 'request_changes']


class ApplicationDecisionSerializer(serializers.Serializer):
    """Input for POST /api/staff/applications/<id>/decision."""

    decision = serializers.ChoiceField(
        choices=_DECISION_CHOICES,
        error_messages={'invalid_choice': 'Must be "approve", "reject", or "request_changes".'},
    )
    # Staff-facing note: MUST NOT be forwarded to volunteers in any email or
    # API response. It is recorded in internal_review_note on the profile.
    internal_review_note = serializers.CharField(allow_blank=True, default='')
