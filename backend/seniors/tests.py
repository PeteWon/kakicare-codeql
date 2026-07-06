"""Tests for senior records: staff-only access, audit logging, soft-delete.

Covers Report II §3.5 (access control) and §3.6/C9 (logging):
  - every senior view is staff-only (SR-AUTHZ-01)
  - every read/write writes exactly one AuditLogEntry (AC-06, SR-AUD-01)
  - audit entries never contain senior PII (SR-AUD-03)
  - deactivation is a soft-delete, preserving the row
"""

from datetime import timedelta

from django.db import connection
from django.urls import reverse

from audit.models import AuditLogEntry
from seniors.fields import _fernet
from kakicare.test_utils import (
    KakiCareAPITestCase,
    create_active_match,
    create_approved_volunteer,
    create_senior,
    create_session,
    create_staff,
)
from matching.models import Match
from seniors.models import Senior
from sessions.models import Session

SECRET_ADDRESS = 'Blk 42 Confidential Ave #12-34'


class SeniorAccessControlTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='caseworker@example.com')
        self.volunteer = create_approved_volunteer(email='nosy@example.com')
        self.senior = create_senior(self.staff, address=SECRET_ADDRESS)

    def test_volunteer_cannot_list_seniors(self):
        # SR-AUTHZ-01: most sensitive data — staff only.
        self.client.force_authenticate(user=self.volunteer)
        resp = self.client.get(reverse('staff-senior-list-create'))
        self.assertEqual(resp.status_code, 403)

    def test_anonymous_cannot_list_seniors(self):
        resp = self.client.get(reverse('staff-senior-list-create'))
        self.assertEqual(resp.status_code, 401)

    def test_staff_can_list_seniors(self):
        self.client.force_authenticate(user=self.staff)
        resp = self.client.get(reverse('staff-senior-list-create'))
        self.assertEqual(resp.status_code, 200)


class SeniorAuditTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='auditor@example.com')
        self.client.force_authenticate(user=self.staff)

    def test_create_writes_single_audit_entry(self):
        resp = self.client.post(
            reverse('staff-senior-list-create'),
            {'full_name': 'New Senior', 'address': SECRET_ADDRESS},
        )
        self.assertEqual(resp.status_code, 201)
        entries = AuditLogEntry.objects.filter(action='senior.create')
        self.assertEqual(entries.count(), 1)
        self.assertEqual(entries.first().target_type, 'Senior')

    def test_read_writes_audit_entry(self):
        senior = create_senior(self.staff)
        self.client.get(reverse('staff-senior-detail', args=[senior.pk]))
        self.assertTrue(
            AuditLogEntry.objects.filter(
                action='senior.read', target_id=str(senior.pk)
            ).exists()
        )

    def test_audit_entries_never_contain_pii(self):
        # SR-AUD-03: create + read + list, then assert no PII landed in any entry.
        self.client.post(
            reverse('staff-senior-list-create'),
            {
                'full_name': 'Mdm Confidential',
                'address': SECRET_ADDRESS,
                'phone_number': '+6591112222',
                'next_of_kin_name': 'Secret Kin',
            },
        )
        senior = Senior.objects.get(full_name='Mdm Confidential')
        self.client.get(reverse('staff-senior-detail', args=[senior.pk]))
        self.client.get(reverse('staff-senior-list-create'))

        blob = ' '.join(
            f'{e.action} {e.target_type} {e.target_id} {e.user_role}'
            for e in AuditLogEntry.objects.all()
        )
        for pii in (SECRET_ADDRESS, '+6591112222', 'Secret Kin', 'Mdm Confidential'):
            self.assertNotIn(pii, blob)


class SeniorPIIEncryptionTests(KakiCareAPITestCase):
    """SR-DATA-05: sensitive Senior fields are encrypted at rest."""

    def _raw_row(self, pk):
        with connection.cursor() as cur:
            cur.execute(
                'SELECT address, phone_number, next_of_kin_name, '
                'next_of_kin_contact FROM seniors_senior WHERE id = %s',
                [pk],
            )
            return cur.fetchone()

    def test_pii_is_ciphertext_at_rest_and_plaintext_via_orm(self):
        staff = create_staff(email='crypto@example.com')
        senior = create_senior(staff, address=SECRET_ADDRESS)

        # The ORM transparently returns plaintext.
        senior.refresh_from_db()
        self.assertEqual(senior.address, SECRET_ADDRESS)
        self.assertEqual(senior.phone_number, '+6590000000')
        self.assertEqual(senior.next_of_kin_name, 'Tan Wei Ming')

        # The raw DB columns hold Fernet ciphertext — never the plaintext.
        stored = self._raw_row(senior.pk)
        plains = [SECRET_ADDRESS, '+6590000000', 'Tan Wei Ming', '+6590000001']
        for ciphertext, plain in zip(stored, plains):
            self.assertNotEqual(ciphertext, plain)
            self.assertNotIn(plain, ciphertext)  # plaintext not even a substring
            # And it decrypts back to the original value.
            self.assertEqual(_fernet().decrypt(ciphertext.encode()).decode(), plain)

    def test_legacy_plaintext_row_is_tolerated_and_reencrypts_on_save(self):
        # Reproduces the data-migration path: a row written before encryption was
        # enabled holds plaintext. Write plaintext straight to the column via raw
        # SQL (bypassing the field), then assert reads tolerate it and a re-save
        # (what the migration does) encrypts it.
        staff = create_staff(email='legacy@example.com')
        senior = create_senior(staff, address=SECRET_ADDRESS)
        with connection.cursor() as cur:
            cur.execute(
                'UPDATE seniors_senior SET address = %s WHERE id = %s',
                ['LEGACY PLAINTEXT', senior.pk],
            )

        # Read tolerates legacy plaintext (decrypt fails → value returned as-is).
        senior.refresh_from_db()
        self.assertEqual(senior.address, 'LEGACY PLAINTEXT')

        # The migration re-saves each row; that encrypts the value at rest.
        senior.save(update_fields=['address'])
        (address, *_rest) = self._raw_row(senior.pk)
        self.assertNotEqual(address, 'LEGACY PLAINTEXT')
        self.assertEqual(_fernet().decrypt(address.encode()).decode(), 'LEGACY PLAINTEXT')

    def test_blank_pii_is_stored_empty_not_ciphertext(self):
        # blank=True must be preserved — no ciphertext produced for empty input.
        staff = create_staff(email='crypto-blank@example.com')
        senior = create_senior(staff, address='')
        (address, _phone, _nok, _nokc) = self._raw_row(senior.pk)
        self.assertEqual(address, '')


class SeniorDeactivationTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='deactivator@example.com')
        self.client.force_authenticate(user=self.staff)
        self.senior = create_senior(self.staff)

    def test_deactivate_is_soft_delete(self):
        resp = self.client.post(
            reverse('staff-senior-deactivate', args=[self.senior.pk])
        )
        self.assertEqual(resp.status_code, 200)
        self.senior.refresh_from_db()
        # Row is preserved (soft-delete), just marked inactive.
        self.assertFalse(self.senior.is_active)
        self.assertTrue(Senior.objects.filter(pk=self.senior.pk).exists())

    def test_double_deactivate_is_rejected(self):
        self.client.post(reverse('staff-senior-deactivate', args=[self.senior.pk]))
        second = self.client.post(
            reverse('staff-senior-deactivate', args=[self.senior.pk])
        )
        self.assertEqual(second.status_code, 400)


class SeniorDeactivationCascadeTests(KakiCareAPITestCase):
    """Deactivating a senior ends their matches and cancels upcoming sessions,
    while leaving in-progress and historical sessions untouched."""

    def setUp(self):
        super().setUp()
        self.staff = create_staff(email='cascade@example.com')
        self.client.force_authenticate(user=self.staff)
        self.volunteer = create_approved_volunteer(email='vol-cascade@example.com')
        self.senior = create_senior(self.staff)
        self.match = create_active_match(self.volunteer, self.senior, self.staff)

    def _deactivate(self):
        return self.client.post(
            reverse('staff-senior-deactivate', args=[self.senior.pk])
        )

    def test_deactivation_ends_active_match(self):
        self.assertEqual(self._deactivate().status_code, 200)
        self.match.refresh_from_db()
        self.assertEqual(self.match.status, Match.Status.ENDED)
        self.assertIsNotNone(self.match.ended_at)

    def test_deactivation_cancels_upcoming_sessions(self):
        pending = create_session(
            self.match, status=Session.Status.PENDING_CONFIRMATION
        )
        confirmed = create_session(
            self.match,
            status=Session.Status.CONFIRMED,
            start_offset=timedelta(hours=3),
        )
        self._deactivate()
        pending.refresh_from_db()
        confirmed.refresh_from_db()
        self.assertEqual(pending.status, Session.Status.CANCELLED)
        self.assertEqual(confirmed.status, Session.Status.CANCELLED)
        self.assertEqual(confirmed.cancel_reason, 'Senior record deactivated.')

    def test_deactivation_leaves_in_progress_session(self):
        in_progress = create_session(
            self.match, status=Session.Status.IN_PROGRESS
        )
        self._deactivate()
        in_progress.refresh_from_db()
        # A visit happening right now must still be checked out.
        self.assertEqual(in_progress.status, Session.Status.IN_PROGRESS)

    def test_deactivation_leaves_completed_session(self):
        completed = create_session(
            self.match, status=Session.Status.COMPLETED
        )
        self._deactivate()
        completed.refresh_from_db()
        self.assertEqual(completed.status, Session.Status.COMPLETED)
