"""Tests for the admin-configurable JIT disclosure window (issue #35).

Report 1 mapping: FR-A-03, SR-ADMIN-02, MC-03.

Covers:
  - server-side 30-minute floor + zero rejection (SR-ADMIN-02)
  - singleton GlobalConfiguration row
  - sessions serializer reads the live config, with a safe fallback
  - admin edits are audit-logged with before/after values + acting admin
"""

from datetime import timedelta

from django.contrib.admin.sites import AdminSite
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from accounts.admin import GlobalConfigurationAdmin
from accounts.models import GlobalConfiguration, User
from audit.models import AuditLogEntry
from kakicare.test_utils import (
    create_active_match,
    create_approved_volunteer,
    create_senior,
    create_session,
    create_staff,
)
from sessions.serializers import _jit_window_open


class _StubMessages:
    """Minimal messages backend so ModelAdmin.message_user doesn't blow up."""

    def add(self, *args, **kwargs):
        pass


class _StubRequest:
    """Minimal request for exercising ModelAdmin.save_model directly."""

    def __init__(self, user, ip='203.0.113.9'):
        self.user = user
        self.META = {'REMOTE_ADDR': ip}
        self._messages = _StubMessages()


class GlobalConfigurationModelTests(TestCase):
    def test_floor_rejects_below_30(self):
        with self.assertRaises(ValidationError):
            GlobalConfiguration(jit_disclosure_window_minutes=29).save()

    def test_floor_rejects_zero(self):
        with self.assertRaises(ValidationError):
            GlobalConfiguration(jit_disclosure_window_minutes=0).save()

    def test_accepts_30_minutes(self):
        GlobalConfiguration(jit_disclosure_window_minutes=30).save()
        self.assertEqual(GlobalConfiguration.objects.count(), 1)

    def test_singleton_enforced(self):
        GlobalConfiguration.objects.create(jit_disclosure_window_minutes=45)
        with self.assertRaises(ValidationError):
            GlobalConfiguration(jit_disclosure_window_minutes=60).save()


class JITWindowSerializerTests(TestCase):
    """_jit_window_open must compute from the live config on every call."""

    def setUp(self):
        self.staff = create_staff()
        self.senior = create_senior(created_by=self.staff)
        self.volunteer = create_approved_volunteer()
        self.match = create_active_match(self.volunteer, self.senior, proposed_by=self.staff)

    def _session_starting_in(self, minutes):
        return create_session(self.match, start_offset=timedelta(minutes=minutes))

    def test_uses_config_window_when_present(self):
        GlobalConfiguration.objects.create(jit_disclosure_window_minutes=30)
        # 90 min out is beyond a 30-min window -> closed
        self.assertFalse(_jit_window_open(self._session_starting_in(90)))
        # 20 min out is inside a 30-min window -> open
        self.assertTrue(_jit_window_open(self._session_starting_in(20)))

    def test_reflects_config_change_without_restart(self):
        session = self._session_starting_in(90)
        GlobalConfiguration.objects.create(jit_disclosure_window_minutes=30)
        self.assertFalse(_jit_window_open(session))  # 30-min window: closed
        cfg = GlobalConfiguration.objects.first()
        cfg.jit_disclosure_window_minutes = 120
        cfg.save()
        self.assertTrue(_jit_window_open(session))  # 120-min window: now open

    def test_falls_back_to_default_without_config(self):
        self.assertEqual(GlobalConfiguration.objects.count(), 0)
        # default fallback is 2h; a 90-min-out session is inside it
        self.assertTrue(_jit_window_open(self._session_starting_in(90)))


class GlobalConfigurationAdminAuditTests(TestCase):
    def setUp(self):
        self.admin = GlobalConfigurationAdmin(GlobalConfiguration, AdminSite())
        self.superuser = User.objects.create_superuser(
            email='admin@example.com', password='pw', full_name='Root Admin'
        )

    def test_change_is_audit_logged_with_before_and_after(self):
        cfg = GlobalConfiguration.objects.create(jit_disclosure_window_minutes=60)
        cfg.jit_disclosure_window_minutes = 90
        self.admin.save_model(_StubRequest(self.superuser), cfg, form=None, change=True)

        entry = AuditLogEntry.objects.filter(target_type='GlobalConfiguration').first()
        self.assertIsNotNone(entry, 'expected an audit entry for the config change')
        self.assertIn('60', entry.action)
        self.assertIn('90', entry.action)
        self.assertEqual(entry.request_ip, '203.0.113.9')
        self.assertEqual(entry.user, self.superuser)
        # value actually persisted
        self.assertEqual(
            GlobalConfiguration.objects.get(pk=cfg.pk).jit_disclosure_window_minutes, 90
        )

    def test_no_audit_when_value_unchanged(self):
        cfg = GlobalConfiguration.objects.create(jit_disclosure_window_minutes=60)
        self.admin.save_model(_StubRequest(self.superuser), cfg, form=None, change=True)
        self.assertEqual(
            AuditLogEntry.objects.filter(target_type='GlobalConfiguration').count(), 0
        )
