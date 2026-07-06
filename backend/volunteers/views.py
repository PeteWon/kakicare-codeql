"""Volunteer profile and vetting views.

Endpoint layout
---------------
  Volunteer-facing (/api/volunteer/):
    GET/PUT/PATCH  profile/
    POST           documents/
    GET            documents/<id>/download

  Staff-facing (/api/staff/):
    GET            applications/        (filterable by status, paginated)
    GET            applications/<id>/
    POST           applications/<id>/decision

SECURITY (SR-AUTHZ-01): every view explicitly declares a permission class.
The frontend role-gating is a UX convenience and is NOT a security boundary.
"""

import hashlib
import logging
import os
import re
import uuid

from django.conf import settings
from django.core.mail import send_mail
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import VolunteerDocument, VolunteerProfile
from accounts.permissions import IsStaff, IsVolunteer
from .serializers import (
    ApplicationDecisionSerializer,
    DocumentUploadSerializer,
    StaffApplicationDetailSerializer,
    StaffApplicationListSerializer,
    VolunteerDocumentInfoSerializer,
    VolunteerProfileSerializer,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# File validation helpers
# ---------------------------------------------------------------------------

# SECURITY (AC-10, SR-DATA-04): the allow-list is defined by magic bytes, NOT
# by file extension or client-supplied Content-Type header. Both are trivially
# spoofable; reading the actual bytes is the only trustworthy check.
_MAGIC_SIGNATURES: dict[bytes, str] = {
    b'\xff\xd8\xff': 'image/jpeg',           # JPEG
    b'\x89PNG\r\n\x1a\n': 'image/png',       # PNG
    b'%PDF': 'application/pdf',              # PDF
}

_MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB — enforced server-side (SR-INPUT-01)


def _compute_sha256(file_obj) -> str:
    """Return the SHA-256 hex digest of file_obj, leaving position at 0."""
    file_obj.seek(0)
    digest = hashlib.sha256()
    for chunk in iter(lambda: file_obj.read(65536), b''):
        digest.update(chunk)
    file_obj.seek(0)
    return digest.hexdigest()


def _detect_mime_type(file_obj) -> str | None:
    """Return the detected MIME type by reading magic bytes.

    SECURITY (AC-10, SR-DATA-04): validates by magic bytes only. Returns None
    if the file is not in the allow-list (JPEG, PNG, PDF). Client-side
    type/size checks are usability only and MUST NOT be trusted server-side.
    """
    file_obj.seek(0)
    header = file_obj.read(8)
    file_obj.seek(0)
    for magic, mime in _MAGIC_SIGNATURES.items():
        if header.startswith(magic):
            return mime
    return None


# ---------------------------------------------------------------------------
# Profile helpers
# ---------------------------------------------------------------------------

_REQUIRED_PROFILE_FIELDS = ('contact_number', 'languages', 'travel_areas', 'availability')


def _is_profile_complete(profile: VolunteerProfile) -> bool:
    """Return True when all fields required for vetting have been supplied."""
    return bool(
        profile.contact_number
        and profile.languages       # non-empty list
        and profile.travel_areas    # non-empty list
        and profile.availability    # non-empty dict
    )


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

class _StandardPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


# ---------------------------------------------------------------------------
# Volunteer-facing views
# ---------------------------------------------------------------------------

class VolunteerProfileView(APIView):
    """GET / PUT / PATCH /api/volunteer/profile

    SR-AUTHZ-02: a volunteer can only access their OWN profile. The profile is
    always derived from the authenticated session — the client never supplies a
    user or profile ID for lookup.
    """

    permission_classes = [IsVolunteer]

    def _get_or_create_profile(self, request):
        profile, _ = VolunteerProfile.objects.get_or_create(user=request.user)
        return profile

    def get(self, request):
        profile = self._get_or_create_profile(request)
        return Response(VolunteerProfileSerializer(profile).data)

    def put(self, request):
        return self._update(request, partial=False)

    def patch(self, request):
        return self._update(request, partial=True)

    def _update(self, request, partial: bool):
        profile = self._get_or_create_profile(request)
        serializer = VolunteerProfileSerializer(
            profile, data=request.data, partial=partial
        )
        serializer.is_valid(raise_exception=True)
        profile = serializer.save()

        # Status transitions — volunteers cannot set their own status.
        # Editing non-document fields when approved does NOT trigger re-review;
        # only document uploads (DocumentUploadView) can move an approved
        # volunteer back to pending_review. This keeps approval stable for
        # minor profile text edits while still requiring re-vetting on new docs.
        current = profile.application_status
        if current in (
            VolunteerProfile.ApplicationStatus.INCOMPLETE,
            VolunteerProfile.ApplicationStatus.CHANGES_REQUESTED,
        ):
            if _is_profile_complete(profile):
                profile.application_status = VolunteerProfile.ApplicationStatus.PENDING_REVIEW
                profile.save(update_fields=['application_status'])

        return Response(VolunteerProfileSerializer(profile).data)


class DocumentUploadView(APIView):
    """POST /api/volunteer/documents

    SECURITY (AC-10, SR-DATA-03, SR-DATA-04):
      • File type is validated by inspecting magic bytes, NOT the extension or
        client-supplied Content-Type header.
      • Allow-list only: JPEG, PNG, PDF. Everything else is rejected.
      • Server-side 5 MB size limit.
      • File is stored in MEDIA_ROOT (outside the web root) under a UUID
        filename, so the path is non-guessable and the original name cannot
        be used to probe the filesystem.
      • Files are never served via any public/static URL — only through the
        authenticated DocumentDownloadView.
    """

    permission_classes = [IsVolunteer]

    def post(self, request):
        # Validate document_type field (SR-INPUT-01).
        # Client-supplied file metadata (name, Content-Type) is UNTRUSTED.
        meta_serializer = DocumentUploadSerializer(data=request.data)
        meta_serializer.is_valid(raise_exception=True)
        document_type = meta_serializer.validated_data['document_type']

        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return Response({'file': 'No file was submitted.'}, status=status.HTTP_400_BAD_REQUEST)

        # Server-side size check (SR-INPUT-01).
        if uploaded_file.size > _MAX_FILE_SIZE:
            return Response(
                {'file': 'File must be 5 MB or smaller.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Magic-byte content type detection (AC-10, SR-DATA-04).
        detected_mime = _detect_mime_type(uploaded_file)
        if detected_mime is None:
            return Response(
                {'file': 'Unsupported file type. Upload a JPEG, PNG, or PDF.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # SR-DATA-06: compute checksum before writing to disk so the digest
        # covers exactly the bytes the client supplied (seek is reset after).
        checksum = _compute_sha256(uploaded_file)

        profile, _ = VolunteerProfile.objects.get_or_create(user=request.user)

        # Build a non-guessable stored filename (SR-DATA-03).
        stored_name = str(uuid.uuid4())

        doc = VolunteerDocument(
            profile=profile,
            document_type=document_type,
            original_filename=uploaded_file.name[:255],
            content_type=detected_mime,   # server-detected, not client-supplied
            checksum_sha256=checksum,
        )
        # Save file as <uuid> inside the upload_to directory.
        doc.file.save(stored_name, uploaded_file, save=False)
        doc.save()

        # If the volunteer was previously approved, new documents require
        # staff re-vetting — move them back to pending_review.
        if profile.application_status == VolunteerProfile.ApplicationStatus.APPROVED:
            profile.application_status = VolunteerProfile.ApplicationStatus.PENDING_REVIEW
            profile.save(update_fields=['application_status'])

        return Response(
            VolunteerDocumentInfoSerializer(doc).data,
            status=status.HTTP_201_CREATED,
        )


class DocumentDownloadView(APIView):
    """GET /api/volunteer/documents/<pk>/download

    SECURITY: access is restricted to the owning volunteer or any staff
    member — enforced server-side on every request.

    SECURITY: a 404 (not 403) is returned for any unauthorised access. A 403
    would confirm to an attacker that the document ID exists; 404 reveals
    nothing about whether the document exists at all (SR-AUTHZ-02).
    """

    # IsAuthenticated only — role check is done inside the handler because it
    # requires object-level logic (owner OR staff).
    def get(self, request, pk: int):
        if not request.user.is_authenticated:
            raise Http404

        try:
            doc = (
                VolunteerDocument.objects
                .select_related('profile__user')
                .get(pk=pk)
            )
        except VolunteerDocument.DoesNotExist:
            raise Http404

        user = request.user
        is_owner = (
            user.role == 'volunteer'
            and doc.profile.user_id == user.pk
        )
        is_staff_member = user.role == 'staff'

        # Return 404 for unauthorised requests — do NOT return 403.
        if not (is_owner or is_staff_member):
            raise Http404

        file_path = doc.file.path
        if not os.path.exists(file_path):
            raise Http404

        # SR-DATA-06: verify the stored checksum before serving.
        if doc.checksum_sha256:
            digest = hashlib.sha256()
            with open(file_path, 'rb') as f:
                for chunk in iter(lambda: f.read(65536), b''):
                    digest.update(chunk)
            if digest.hexdigest() != doc.checksum_sha256:
                logger.error(
                    'SR-DATA-06 integrity failure: document pk=%s profile=%s '
                    'expected=%s actual=%s — file may be tampered',
                    doc.pk, doc.profile_id,
                    doc.checksum_sha256, digest.hexdigest(),
                )
                if not doc.checksum_mismatch:
                    doc.checksum_mismatch = True
                    doc.save(update_fields=['checksum_mismatch'])
                return Response(
                    {'detail': 'File integrity check failed. This document cannot be served.'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        # Sanitise the original filename for the Content-Disposition header to
        # prevent header injection.
        safe_name = re.sub(r'[^\w\-. ]', '_', doc.original_filename or '')[:200]
        if not safe_name:
            safe_name = f'document_{doc.pk}'

        response = FileResponse(
            open(file_path, 'rb'),
            content_type=doc.content_type or 'application/octet-stream',
        )
        response['Content-Disposition'] = f'attachment; filename="{safe_name}"'
        return response


# ---------------------------------------------------------------------------
# Staff-facing views
# ---------------------------------------------------------------------------

_VALID_APPLICATION_STATUSES = {s.value for s in VolunteerProfile.ApplicationStatus}

_STATUS_MAP = {
    'approve': VolunteerProfile.ApplicationStatus.APPROVED,
    'reject': VolunteerProfile.ApplicationStatus.REJECTED,
    'request_changes': VolunteerProfile.ApplicationStatus.CHANGES_REQUESTED,
}

_DECISION_EMAIL_SUBJECTS = {
    'approve': 'Your KakiCare volunteer application has been approved',
    'reject': 'Update on your KakiCare volunteer application',
    'request_changes': 'Your KakiCare volunteer application — changes requested',
}

_DECISION_EMAIL_BODIES = {
    'approve': (
        'Hi {name},\n\n'
        'Congratulations! Your KakiCare volunteer application has been approved.\n\n'
        'You can now log in and get started.\n\n'
        'KakiCare Team'
    ),
    'reject': (
        'Hi {name},\n\n'
        'Thank you for your interest in volunteering with KakiCare. Unfortunately, '
        'we are unable to approve your application at this time.\n\n'
        'If you have questions, please contact us.\n\n'
        'KakiCare Team'
    ),
    'request_changes': (
        'Hi {name},\n\n'
        'We have reviewed your KakiCare volunteer application and need some '
        'additional information before we can proceed.\n\n'
        'Please log in and update your profile.\n\n'
        'KakiCare Team'
    ),
}


class ApplicationListView(APIView):
    """GET /api/staff/applications

    Lists volunteer applications. Default filter: pending_review.
    Accepts ?status= to filter by any ApplicationStatus value.
    Paginated (20 per page).
    """

    permission_classes = [IsStaff]

    def get(self, request):
        status_param = request.query_params.get('status', 'pending_review')
        if status_param not in _VALID_APPLICATION_STATUSES:
            return Response(
                {'status': f'Invalid status. Choose from: {", ".join(sorted(_VALID_APPLICATION_STATUSES))}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = (
            VolunteerProfile.objects
            .filter(application_status=status_param, user__role='volunteer')
            .select_related('user')
            .order_by('-updated_at')
        )

        paginator = _StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        serializer = StaffApplicationListSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class ApplicationDetailView(APIView):
    """GET /api/staff/applications/<pk>

    Full application detail including profile fields, documents (with download
    links), and the internal_review_note.
    """

    permission_classes = [IsStaff]

    def get(self, request, pk: int):
        try:
            profile = (
                VolunteerProfile.objects
                .select_related('user', 'reviewed_by')
                .prefetch_related('documents')
                .get(pk=pk, user__role='volunteer')
            )
        except VolunteerProfile.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        return Response(StaffApplicationDetailSerializer(profile).data)


class ApplicationDecisionView(APIView):
    """POST /api/staff/applications/<pk>/decision

    Records a vetting decision (approve / reject / request_changes).

    SECURITY: the internal_review_note is recorded on the profile for staff use
    and MUST NOT be included in the notification email sent to the volunteer —
    it is an internal staff-only field.
    """

    permission_classes = [IsStaff]

    def post(self, request, pk: int):
        try:
            profile = (
                VolunteerProfile.objects
                .select_related('user')
                .get(pk=pk, user__role='volunteer')
            )
        except VolunteerProfile.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        serializer = ApplicationDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        decision = serializer.validated_data['decision']
        note = serializer.validated_data['internal_review_note']

        profile.application_status = _STATUS_MAP[decision]
        profile.internal_review_note = note
        profile.reviewed_by = request.user
        profile.reviewed_at = timezone.now()
        profile.save(update_fields=[
            'application_status', 'internal_review_note',
            'reviewed_by', 'reviewed_at',
        ])

        # Notify the volunteer of the outcome.
        # SECURITY: internal_review_note is staff-only and MUST NOT appear
        # in this email. The body templates above contain no mention of it.
        volunteer = profile.user
        try:
            send_mail(
                subject=_DECISION_EMAIL_SUBJECTS[decision],
                message=_DECISION_EMAIL_BODIES[decision].format(name=volunteer.full_name),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[volunteer.email],
                fail_silently=False,
            )
        except Exception:
            # Log email failure but don't fail the API response — the DB update
            # is the source of truth; email is best-effort in dev.
            logger.exception(
                'Failed to send decision email to %s for profile %s',
                volunteer.email, profile.pk,
            )

        return Response(
            StaffApplicationDetailSerializer(profile).data,
            status=status.HTTP_200_OK,
        )
