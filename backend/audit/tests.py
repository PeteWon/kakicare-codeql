"""Tests for the append-only audit log API.

Covers Report II §3.5 (audit log integrity, SR-AUD-02): the audit log exposes a
single GET endpoint — there is no create/update/delete path — and it is
staff-only.
"""

from django.urls import reverse

from audit.services import record_audit
from kakicare.test_utils import (
    KakiCareAPITestCase,
    create_approved_volunteer,
    create_staff,
)


class AuditLogApiTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='oversight@example.com')
        self.url = reverse('staff-audit-log')

    def test_staff_can_read_audit_log(self):
        self.client.force_authenticate(user=self.staff)
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_volunteer_cannot_read_audit_log(self):
        volunteer = create_approved_volunteer(email='peeker@example.com')
        self.client.force_authenticate(user=volunteer)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_audit_log_is_append_only_no_write_methods(self):
        # SR-AUD-02: only GET is allowed; mutating verbs return 405.
        self.client.force_authenticate(user=self.staff)
        self.assertEqual(self.client.post(self.url, {}).status_code, 405)
        self.assertEqual(self.client.put(self.url, {}).status_code, 405)
        self.assertEqual(self.client.delete(self.url).status_code, 405)

    def test_record_audit_stores_only_references(self):
        # The helper records a reference, not record contents (SR-AUD-03).
        entry = record_audit(
            user=self.staff,
            action='senior.read',
            target_type='Senior',
            target_id=123,
            metadata={'review': 'ok'},
            request_ip='203.0.113.7',
        )
        self.assertEqual(entry.action, 'senior.read')
        self.assertEqual(entry.target_id, '123')
        self.assertEqual(entry.user_role, self.staff.role)
        self.assertEqual(entry.metadata['review'], 'ok')
