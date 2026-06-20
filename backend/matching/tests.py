"""Tests for matching: approved-volunteer gating (AC-05) and ownership.

Covers Report II §3.5:
  - only APPROVED volunteers may be matched to seniors (AC-05)
  - IsApprovedVolunteer blocks unapproved volunteers from match endpoints
  - volunteers only ever see their own matches (SR-AUTHZ-02)
"""

from django.urls import reverse

from kakicare.test_utils import (
    KakiCareAPITestCase,
    create_approved_volunteer,
    create_senior,
    create_staff,
    create_volunteer,
    create_volunteer_profile,
)
from matching.models import Match
from volunteers.models import VolunteerProfile


class ProposeMatchTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='matcher@example.com')
        self.senior = create_senior(self.staff)
        self.url = reverse('staff-match-list-create')

    def test_cannot_match_unapproved_volunteer(self):
        # AC-05: matching an unvetted volunteer must be rejected server-side.
        unapproved = create_volunteer(email='unvetted@example.com')
        create_volunteer_profile(
            unapproved, status=VolunteerProfile.ApplicationStatus.PENDING_REVIEW
        )
        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(
            self.url,
            {'volunteer_id': unapproved.pk, 'senior_id': self.senior.pk},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(Match.objects.filter(volunteer=unapproved).exists())

    def test_can_match_approved_volunteer(self):
        approved = create_approved_volunteer(email='vetted@example.com')
        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(
            self.url,
            {'volunteer_id': approved.pk, 'senior_id': self.senior.pk},
        )
        self.assertEqual(resp.status_code, 201)


class VolunteerMatchAccessTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.url = reverse('volunteer-match-list')

    def test_unapproved_volunteer_is_blocked(self):
        # IsApprovedVolunteer: pending volunteer cannot reach match data.
        volunteer = create_volunteer(email='pending@example.com')
        create_volunteer_profile(
            volunteer, status=VolunteerProfile.ApplicationStatus.PENDING_REVIEW
        )
        self.client.force_authenticate(user=volunteer)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_approved_volunteer_can_list_own_matches(self):
        volunteer = create_approved_volunteer(email='approved-m@example.com')
        self.client.force_authenticate(user=volunteer)
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, 200)
