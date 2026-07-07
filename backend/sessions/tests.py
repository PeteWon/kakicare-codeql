"""Tests for befriending sessions: JIT disclosure, check-in codes, ownership.

Covers Report II §3.5:
  - just-in-time disclosure of senior contact details (SR-AUTHZ-03)
  - single-use, hashed, constant-time, rate-limited check-in codes (AC-04)
  - volunteer ownership derived from session; 404 (not 403) on cross-access
"""

import hashlib
from datetime import timedelta

from django.urls import reverse
from django.utils import timezone

from audit.models import AuditLogEntry
from kakicare.test_utils import (
    KakiCareAPITestCase,
    create_active_match,
    create_approved_volunteer,
    create_senior,
    create_session,
    create_staff,
)
from sessions.models import Session


class JitDisclosureTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='coord@example.com')
        self.volunteer = create_approved_volunteer(email='vol-jit@example.com')
        self.senior = create_senior(self.staff, address='Blk 7 Bedok Nth Rd #05-09')
        self.match = create_active_match(self.volunteer, self.senior, self.staff)
        self.client.force_authenticate(user=self.volunteer)

    def _get_senior_payload(self, session):
        resp = self.client.get(
            reverse('volunteer-session-detail', args=[session.pk])
        )
        self.assertEqual(resp.status_code, 200)
        return resp.data['senior'], resp.data['jit_disclosure_active']

    def test_full_contact_disclosed_inside_window(self):
        # now is within [start-2h, end+1h] → window open.
        session = create_session(self.match, start_offset=timedelta(minutes=30))
        senior, active = self._get_senior_payload(session)
        self.assertTrue(active)
        self.assertIn('address', senior)
        self.assertIn('phone_number', senior)
        self.assertIn('next_of_kin_name', senior)

    def test_limited_contact_outside_window(self):
        # Session is a day away → window closed.
        session = create_session(self.match, start_offset=timedelta(days=1))
        senior, active = self._get_senior_payload(session)
        self.assertFalse(active)
        self.assertNotIn('address', senior)
        self.assertNotIn('phone_number', senior)
        self.assertIn('locality', senior)
        self.assertIn('first_name', senior)


class CheckInTests(KakiCareAPITestCase):
    RAW_CODE = '123456'

    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='coord2@example.com')
        self.volunteer = create_approved_volunteer(email='vol-ci@example.com')
        self.senior = create_senior(self.staff)
        self.match = create_active_match(self.volunteer, self.senior, self.staff)
        self.session = create_session(
            self.match,
            status=Session.Status.CONFIRMED,
            checkin_code_hash=hashlib.sha256(self.RAW_CODE.encode()).hexdigest(),
        )
        self.url = reverse('volunteer-session-checkin', args=[self.session.pk])
        self.client.force_authenticate(user=self.volunteer)

    def test_correct_code_checks_in(self):
        resp = self.client.post(self.url, {'code': self.RAW_CODE})
        self.assertEqual(resp.status_code, 200)
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, Session.Status.IN_PROGRESS)
        self.assertTrue(
            AuditLogEntry.objects.filter(
                action='session.checkin', target_id=str(self.session.pk)
            ).exists()
        )

    def test_wrong_code_is_rejected_and_audited_as_failure(self):
        resp = self.client.post(self.url, {'code': '000000'})
        self.assertEqual(resp.status_code, 400)
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, Session.Status.CONFIRMED)
        self.assertTrue(
            AuditLogEntry.objects.filter(
                action='session.checkin_fail', target_id=str(self.session.pk)
            ).exists()
        )

    def test_checkin_is_rate_limited(self):
        # AC-04: 5 attempts / 15 min per IP → 6th throttled.
        for _ in range(5):
            resp = self.client.post(self.url, {'code': '000000'})
            self.assertNotEqual(resp.status_code, 429)
        throttled = self.client.post(self.url, {'code': '000000'})
        self.assertEqual(throttled.status_code, 429)


class SessionOwnershipTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='coord3@example.com')
        self.owner = create_approved_volunteer(email='owner-v@example.com')
        self.intruder = create_approved_volunteer(email='intruder-v@example.com')
        self.senior = create_senior(self.staff)
        match = create_active_match(self.owner, self.senior, self.staff)
        self.session = create_session(match)

    def test_other_volunteer_gets_404_not_403(self):
        # SR-AUTHZ-02: existence hidden — wrong owner sees 404.
        self.client.force_authenticate(user=self.intruder)
        resp = self.client.get(
            reverse('volunteer-session-detail', args=[self.session.pk])
        )
        self.assertEqual(resp.status_code, 404)

    def test_owner_can_view_own_session(self):
        self.client.force_authenticate(user=self.owner)
        resp = self.client.get(
            reverse('volunteer-session-detail', args=[self.session.pk])
        )
        self.assertEqual(resp.status_code, 200)


class SessionBookingGuardTests(KakiCareAPITestCase):
    """A volunteer must not be able to book a session against a senior whose
    record has been deactivated, even if an ACTIVE match still exists."""

    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='coord-book@example.com')
        self.volunteer = create_approved_volunteer(email='vol-book@example.com')
        self.senior = create_senior(self.staff)
        self.match = create_active_match(self.volunteer, self.senior, self.staff)
        self.client.force_authenticate(user=self.volunteer)
        self.url = reverse('volunteer-session-list-create')

    def _payload(self):
        # Pin to a fixed in-window local time (10:00 SGT) so the booking passes
        # the business-hours check regardless of when the suite actually runs.
        start = (timezone.localtime(timezone.now()) + timedelta(days=1)).replace(
            hour=10, minute=0, second=0, microsecond=0
        )
        return {
            'match_id': self.match.pk,
            'session_type': 'visit',
            'scheduled_start': start.isoformat(),
            'scheduled_end': (start + timedelta(hours=1)).isoformat(),
        }

    def test_can_book_for_active_senior(self):
        resp = self.client.post(self.url, self._payload(), format='json')
        self.assertEqual(resp.status_code, 201)

    def test_cannot_book_for_deactivated_senior(self):
        self.senior.is_active = False
        self.senior.save(update_fields=['is_active'])
        resp = self.client.post(self.url, self._payload(), format='json')
        self.assertEqual(resp.status_code, 400)
        # No session row created.
        self.assertEqual(Session.objects.filter(match=self.match).count(), 0)

    def test_rejects_start_before_business_hours(self):
        payload = self._payload()
        start = (timezone.localtime(timezone.now()) + timedelta(days=1)).replace(
            hour=6, minute=0, second=0, microsecond=0
        )
        payload['scheduled_start'] = start.isoformat()
        payload['scheduled_end'] = (start + timedelta(hours=1)).isoformat()
        resp = self.client.post(self.url, payload, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('scheduled_start', resp.data)
        self.assertEqual(Session.objects.filter(match=self.match).count(), 0)

    def test_rejects_end_after_business_hours(self):
        payload = self._payload()
        start = (timezone.localtime(timezone.now()) + timedelta(days=1)).replace(
            hour=17, minute=30, second=0, microsecond=0
        )
        payload['scheduled_start'] = start.isoformat()
        payload['scheduled_end'] = (start + timedelta(hours=1)).isoformat()  # 18:30
        resp = self.client.post(self.url, payload, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('scheduled_end', resp.data)
        self.assertEqual(Session.objects.filter(match=self.match).count(), 0)
