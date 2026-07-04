"""Tests for welfare concern reporting (FR-V-14).

Covers:
  - Volunteer creates a concern about a senior (with and without a linked session)
  - Session ownership gate: 404 (not 403) when volunteer tries to link another
    volunteer's session (SR-AUTHZ-02)
  - Validation: required fields, invalid PKs
  - Staff list endpoint with ?status= filter
  - Staff resolve endpoint: happy path, idempotency guard (409)
  - Role enforcement: volunteer cannot hit staff endpoints (403)
  - Audit log entries produced on submit and resolve (SR-AUD-03)
"""

import uuid

from django.urls import reverse

from audit.models import AuditLogEntry
from concerns.models import WelfareConcern
from kakicare.test_utils import (
    KakiCareAPITestCase,
    create_active_match,
    create_approved_volunteer,
    create_senior,
    create_session,
    create_staff,
)


class ConcernCreateTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='coord@example.com')
        self.volunteer = create_approved_volunteer(email='vol@example.com')
        self.senior = create_senior(self.staff)
        self.url = reverse('volunteer-concern-create')
        self.client.force_authenticate(user=self.volunteer)

    def _post(self, payload):
        return self.client.post(self.url, payload, format='json')

    def test_create_concern_no_session_returns_201(self):
        resp = self._post({'target_senior': self.senior.pk, 'description': 'Seems unwell.'})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['target_senior']['id'], self.senior.pk)
        self.assertEqual(resp.data['status'], 'open')
        self.assertIsNone(resp.data['session'])
        self.assertEqual(WelfareConcern.objects.count(), 1)

    def test_create_concern_with_own_session_links_session(self):
        match = create_active_match(self.volunteer, self.senior, self.staff)
        session = create_session(match)
        resp = self._post({
            'target_senior': self.senior.pk,
            'description': 'Senior looked tired.',
            'session': session.pk,
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['session']['id'], session.pk)
        concern = WelfareConcern.objects.get(pk=resp.data['id'])
        self.assertEqual(concern.session_id, session.pk)

    def test_create_concern_with_other_volunteers_session_returns_404(self):
        other_vol = create_approved_volunteer(email='other@example.com')
        other_senior = create_senior(self.staff, full_name='Mr Other')
        match = create_active_match(other_vol, other_senior, self.staff)
        session = create_session(match)
        resp = self._post({
            'target_senior': self.senior.pk,
            'description': 'Concern.',
            'session': session.pk,
        })
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(WelfareConcern.objects.count(), 0)

    def test_create_concern_missing_target_senior_returns_400(self):
        resp = self._post({'description': 'Something is wrong.'})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('target_senior', resp.data)

    def test_create_concern_invalid_senior_pk_returns_400(self):
        resp = self._post({'target_senior': 999999, 'description': 'Concern.'})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('target_senior', resp.data)

    def test_submit_produces_one_audit_entry_with_correct_fields(self):
        resp = self._post({'target_senior': self.senior.pk, 'description': 'Test.'})
        self.assertEqual(resp.status_code, 201)
        entries = AuditLogEntry.objects.filter(action='concern.submitted')
        self.assertEqual(entries.count(), 1)
        entry = entries.first()
        self.assertEqual(entry.target_type, 'WelfareConcern')
        self.assertEqual(entry.target_id, str(resp.data['id']))


class StaffConcernListTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='coord@example.com')
        self.volunteer = create_approved_volunteer(email='vol@example.com')
        self.senior = create_senior(self.staff)
        self.url = reverse('staff-concern-list')
        self.client.force_authenticate(user=self.staff)

        self.open_concern = WelfareConcern.objects.create(
            raised_by=self.volunteer,
            target_senior=self.senior,
            description='Open concern.',
            status=WelfareConcern.Status.OPEN,
        )
        self.resolved_concern = WelfareConcern.objects.create(
            raised_by=self.volunteer,
            target_senior=self.senior,
            description='Resolved concern.',
            status=WelfareConcern.Status.RESOLVED,
            resolved_by=self.staff,
            resolution_note='Followed up.',
        )

    def test_list_returns_all_concerns(self):
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 2)

    def test_filter_by_open_status(self):
        resp = self.client.get(self.url, {'status': 'open'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 1)
        self.assertEqual(resp.data['results'][0]['status'], 'open')

    def test_filter_by_resolved_status(self):
        resp = self.client.get(self.url, {'status': 'resolved'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 1)
        self.assertEqual(resp.data['results'][0]['status'], 'resolved')

    def test_invalid_status_filter_returns_all_concerns(self):
        resp = self.client.get(self.url, {'status': 'bogus'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 2)


class StaffConcernResolveTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='coord@example.com')
        self.volunteer = create_approved_volunteer(email='vol@example.com')
        self.senior = create_senior(self.staff)
        self.concern = WelfareConcern.objects.create(
            raised_by=self.volunteer,
            target_senior=self.senior,
            description='Senior fell.',
        )
        self.url = reverse('staff-concern-resolve', args=[self.concern.pk])
        self.client.force_authenticate(user=self.staff)

    def test_resolve_open_concern_returns_200_with_correct_fields(self):
        resp = self.client.post(self.url, {'resolution_note': 'Called next of kin.'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'resolved')
        self.assertEqual(resp.data['resolution_note'], 'Called next of kin.')
        self.assertEqual(resp.data['resolved_by']['id'], self.staff.pk)
        self.assertIsNotNone(resp.data['resolved_at'])

    def test_resolve_sets_db_fields_correctly(self):
        self.client.post(self.url, {'resolution_note': 'Done.'}, format='json')
        self.concern.refresh_from_db()
        self.assertEqual(self.concern.status, WelfareConcern.Status.RESOLVED)
        self.assertEqual(self.concern.resolved_by_id, self.staff.pk)
        self.assertIsNotNone(self.concern.resolved_at)
        self.assertEqual(self.concern.resolution_note, 'Done.')

    def test_resolve_already_resolved_concern_returns_409(self):
        self.client.post(self.url, {'resolution_note': 'First resolve.'}, format='json')
        resp = self.client.post(self.url, {'resolution_note': 'Second attempt.'}, format='json')
        self.assertEqual(resp.status_code, 409)

    def test_resolve_nonexistent_concern_returns_404(self):
        url = reverse('staff-concern-resolve', args=[uuid.uuid4()])
        resp = self.client.post(url, {}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_resolve_produces_one_audit_entry_with_correct_fields(self):
        self.client.post(self.url, {'resolution_note': 'Noted.'}, format='json')
        entries = AuditLogEntry.objects.filter(action='concern.resolved')
        self.assertEqual(entries.count(), 1)
        entry = entries.first()
        self.assertEqual(entry.target_type, 'WelfareConcern')
        self.assertEqual(entry.target_id, str(self.concern.pk))


class ConcernPermissionTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='coord@example.com')
        self.volunteer = create_approved_volunteer(email='vol@example.com')
        self.senior = create_senior(self.staff)
        self.concern = WelfareConcern.objects.create(
            raised_by=self.volunteer,
            target_senior=self.senior,
            description='Test concern.',
        )
        self.client.force_authenticate(user=self.volunteer)

    def test_volunteer_cannot_access_staff_list_endpoint(self):
        resp = self.client.get(reverse('staff-concern-list'))
        self.assertEqual(resp.status_code, 403)

    def test_volunteer_cannot_access_staff_resolve_endpoint(self):
        url = reverse('staff-concern-resolve', args=[self.concern.pk])
        resp = self.client.post(url, {}, format='json')
        self.assertEqual(resp.status_code, 403)
