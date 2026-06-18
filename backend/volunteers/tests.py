"""Tests for volunteer document upload, download access control and vetting.

Covers Report II §3.6 (C5/C8 secure coding) and §3.5 (access control):
  - upload validated by magic bytes, not extension/Content-Type (AC-10, SR-DATA-04)
  - server-side 5 MB size limit (SR-INPUT-01)
  - documents served only to owner or staff; 404 (not 403) otherwise (SR-AUTHZ-02)
  - internal_review_note is staff-only and never returned to the volunteer
"""

import shutil
import tempfile

from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from kakicare.test_utils import (
    KakiCareAPITestCase,
    create_approved_volunteer,
    create_staff,
    create_volunteer,
    create_volunteer_profile,
)
from volunteers.models import VolunteerDocument, VolunteerProfile

PNG_BYTES = b'\x89PNG\r\n\x1a\n' + b'\x00' * 128
PDF_BYTES = b'%PDF-1.4\n' + b'0' * 128
EXE_BYTES = b'MZ\x90\x00' + b'\x00' * 128  # PE/exe header — not in the allow-list

_TMP_MEDIA = tempfile.mkdtemp(prefix='kakicare-test-media-')


@override_settings(MEDIA_ROOT=_TMP_MEDIA)
class DocumentUploadTests(KakiCareAPITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_TMP_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        self.url = reverse('volunteer-documents-upload')
        self.volunteer = create_approved_volunteer(email='uploader@example.com')
        self.client.force_authenticate(user=self.volunteer)

    def _upload(self, name, content, content_type):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile(name, content, content_type=content_type)
        return self.client.post(
            self.url,
            {'document_type': 'identity', 'file': upload},
            format='multipart',
        )

    def test_valid_png_is_accepted(self):
        resp = self._upload('id.png', PNG_BYTES, 'image/png')
        self.assertEqual(resp.status_code, 201)

    def test_disguised_executable_is_rejected_by_magic_bytes(self):
        # Lying about the name and Content-Type must not get an exe accepted.
        resp = self._upload('totally-an-image.png', EXE_BYTES, 'image/png')
        self.assertEqual(resp.status_code, 400)

    def test_oversize_file_is_rejected(self):
        big = PDF_BYTES + b'0' * (5 * 1024 * 1024)
        resp = self._upload('big.pdf', big, 'application/pdf')
        self.assertEqual(resp.status_code, 400)

    def test_stored_filename_is_not_the_original(self):
        self._upload('my-secret-name.png', PNG_BYTES, 'image/png')
        doc = VolunteerDocument.objects.get(profile__user=self.volunteer)
        # SR-DATA-03: stored under a non-guessable name, not the original.
        self.assertNotIn('my-secret-name', doc.file.name)


@override_settings(MEDIA_ROOT=_TMP_MEDIA)
class DocumentDownloadAccessTests(KakiCareAPITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_TMP_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        super().setUp()
        self.owner = create_approved_volunteer(email='owner@example.com')
        self.other = create_approved_volunteer(email='other@example.com')
        self.staff = create_staff(email='reviewer@example.com')

        # Owner uploads a document.
        owner_client = APIClient()
        owner_client.force_authenticate(user=self.owner)
        from django.core.files.uploadedfile import SimpleUploadedFile

        owner_client.post(
            reverse('volunteer-documents-upload'),
            {
                'document_type': 'identity',
                'file': SimpleUploadedFile('id.png', PNG_BYTES, content_type='image/png'),
            },
            format='multipart',
        )
        self.doc = VolunteerDocument.objects.get(profile__user=self.owner)
        self.url = reverse('volunteer-document-download', args=[self.doc.pk])

    def test_owner_can_download(self):
        self.client.force_authenticate(user=self.owner)
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_staff_can_download(self):
        self.client.force_authenticate(user=self.staff)
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_other_volunteer_gets_404_not_403(self):
        # SR-AUTHZ-02: existence is hidden — 404, never 403.
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_anonymous_is_unauthorised(self):
        # Anonymous requests are rejected at the auth layer with 401 (consistent
        # app-wide). This leaks nothing: every pk returns 401, so existence stays
        # hidden — the 404-not-403 guarantee covers authenticated non-owners above.
        self.assertEqual(self.client.get(self.url).status_code, 401)


class VettingTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='vetter@example.com')
        self.volunteer = create_volunteer(email='applicant@example.com')
        self.profile = create_volunteer_profile(
            self.volunteer, status=VolunteerProfile.ApplicationStatus.PENDING_REVIEW
        )

    def test_internal_review_note_is_not_exposed_to_volunteer(self):
        # Staff records a decision with an internal note.
        self.client.force_authenticate(user=self.staff)
        secret_note = 'INTERNAL: reference check pending'
        self.client.post(
            reverse('staff-applications-decision', args=[self.profile.pk]),
            {'decision': 'approve', 'internal_review_note': secret_note},
        )

        # The volunteer fetches their own profile — the note must not appear.
        self.client.force_authenticate(user=self.volunteer)
        resp = self.client.get(reverse('volunteer-profile'))
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('internal_review_note', resp.data)
        self.assertNotIn(secret_note, str(resp.data))

    def test_volunteer_cannot_reach_staff_application_list(self):
        # SR-AUTHZ-01: role enforced server-side (authenticated but wrong role → 403).
        self.client.force_authenticate(user=self.volunteer)
        resp = self.client.get(reverse('staff-applications-list'))
        self.assertEqual(resp.status_code, 403)
