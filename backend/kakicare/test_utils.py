"""Shared test fixtures and helpers for the KakiCare backend test suite.

These helpers build the small object graph the security tests need
(volunteer / staff users, approved volunteers with a profile, seniors, matches,
sessions, confirmed TOTP devices) so individual test modules stay focused on
*behaviour* rather than setup boilerplate.

Design notes:
  * `KakiCareAPITestCase` clears the cache in setUp. DRF throttles use the cache
    backend, so without this a throttle bucket would leak across tests and make
    rate-limit assertions flaky.
  * `current_totp` derives a valid one-time code from a TOTPDevice's own key so
    MFA login can be exercised end-to-end without a real authenticator app.
"""

import time
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from django_otp.oath import TOTP
from django_otp.plugins.otp_totp.models import TOTPDevice
from rest_framework.test import APITestCase

from accounts.models import User
from matching.models import Match
from seniors.models import Senior
from sessions.models import Session
from volunteers.models import VolunteerProfile

DEFAULT_PASSWORD = 'Sup3rSecret-Passphrase!'  # >= 12 chars, passes the validators


def create_volunteer(
    email='volunteer@example.com',
    *,
    password=DEFAULT_PASSWORD,
    full_name='Vera Volunteer',
    is_active=True,
    is_email_verified=True,
):
    """Create a volunteer User (no profile)."""
    return User.objects.create_user(
        email=email,
        password=password,
        full_name=full_name,
        role=User.Role.VOLUNTEER,
        is_active=is_active,
        is_email_verified=is_email_verified,
    )


def create_staff(
    email='staff@example.com',
    *,
    password=DEFAULT_PASSWORD,
    full_name='Stan Staff',
):
    """Create a staff User (active + verified, ready to authenticate)."""
    return User.objects.create_user(
        email=email,
        password=password,
        full_name=full_name,
        role=User.Role.STAFF,
        is_active=True,
        is_email_verified=True,
    )


def create_volunteer_profile(user, *, status=VolunteerProfile.ApplicationStatus.APPROVED):
    """Attach a VolunteerProfile to a user with the given application status."""
    return VolunteerProfile.objects.create(
        user=user,
        application_status=status,
        contact_number='+6591234567',
        languages=['English'],
        travel_areas=['Tampines'],
        availability={'Mon': ['Morning']},
    )


def create_approved_volunteer(email='approved@example.com', **kwargs):
    """Create a volunteer User WITH an approved profile (passes IsApprovedVolunteer)."""
    user = create_volunteer(email=email, **kwargs)
    create_volunteer_profile(user, status=VolunteerProfile.ApplicationStatus.APPROVED)
    return user


def create_senior(
    created_by,
    *,
    full_name='Mdm Tan Bee Hoon',
    address='Blk 1 Tampines St 11 #01-01',
    consent_status=Senior.ConsentStatus.GIVEN,
):
    """Create a Senior record owned by the given staff user.

    Defaults to consent_status=GIVEN so tests that exercise matching and session
    booking aren't blocked by the consent gate (FR-S-13). Pass
    consent_status=Senior.ConsentStatus.NOT_RECORDED to test the gate itself.
    """
    return Senior.objects.create(
        full_name=full_name,
        address=address,
        phone_number='+6590000000',
        preferred_language='Mandarin',
        next_of_kin_name='Tan Wei Ming',
        next_of_kin_contact='+6590000001',
        created_by=created_by,
        consent_status=consent_status,
    )


def create_active_match(volunteer, senior, proposed_by):
    """Create an ACTIVE match between a volunteer and a senior."""
    return Match.objects.create(
        volunteer=volunteer,
        senior=senior,
        proposed_by=proposed_by,
        status=Match.Status.ACTIVE,
        volunteer_accepted_at=timezone.now(),
        senior_confirmed_at=timezone.now(),
    )


def create_session(
    match,
    *,
    status=Session.Status.PENDING_CONFIRMATION,
    start_offset=timedelta(minutes=30),
    duration=timedelta(hours=1),
    session_type=Session.SessionType.VISIT,
    checkin_code_hash='',
):
    """Create a Session under a match. Times are relative to now()."""
    start = timezone.now() + start_offset
    return Session.objects.create(
        match=match,
        session_type=session_type,
        scheduled_start=start,
        scheduled_end=start + duration,
        status=status,
        checkin_code_hash=checkin_code_hash,
    )


def add_confirmed_totp_device(user):
    """Create and return a confirmed TOTP device for the user."""
    return TOTPDevice.objects.create(user=user, name=f'totp-{user.pk}', confirmed=True)


def current_totp(device):
    """Return the current valid TOTP code for a device as a zero-padded string."""
    totp = TOTP(device.bin_key, device.step, device.t0, device.digits, device.drift)
    totp.time = time.time()
    return str(totp.token()).zfill(device.digits)


class KakiCareAPITestCase(APITestCase):
    """Base test case that clears the cache between tests (for throttle isolation)."""

    def setUp(self):
        super().setUp()
        cache.clear()

    def tearDown(self):
        cache.clear()
        super().tearDown()
