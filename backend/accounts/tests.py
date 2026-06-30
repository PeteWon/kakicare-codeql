"""Tests for authentication, MFA, password reset and registration.

Covers the controls described in Report II §3.3 (Secure Login):
  - anti-enumeration + timing-equalised login (SR-AUTH-06)
  - mandatory staff MFA (SR-AUTH-03)
  - login rate-limiting (SR-AUTH-04)
  - single-use hashed tokens + session invalidation on password change
  - server-side password policy (SR-AUTH-02)
"""

import re
from datetime import timedelta

from django.core import mail
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import (
    EmailVerificationToken,
    MFAResetRequest,
    PasswordResetToken,
    StaffInviteToken,
    User,
)
from accounts.views import (
    _generate_backup_codes,
    _hash_token,
    issue_and_send_staff_invite,
)
from kakicare.test_utils import (
    DEFAULT_PASSWORD,
    KakiCareAPITestCase,
    add_confirmed_totp_device,
    create_staff,
    create_volunteer,
    current_totp,
)
from audit.models import AuditLogEntry


class LoginTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.url = reverse('auth-login')
        self.volunteer = create_volunteer(email='vol@example.com')

    def test_valid_volunteer_login_succeeds(self):
        resp = self.client.post(
            self.url, {'email': 'vol@example.com', 'password': DEFAULT_PASSWORD}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'success')
        self.assertEqual(resp.data['role'], User.Role.VOLUNTEER)

    def test_wrong_password_returns_generic_invalid(self):
        resp = self.client.post(
            self.url, {'email': 'vol@example.com', 'password': 'wrong-password-x'}
        )
        # SR-AUTH-06: generic response, HTTP 200, no detail leak.
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, {'status': 'invalid'})

    def test_unknown_email_returns_same_generic_invalid(self):
        resp = self.client.post(
            self.url, {'email': 'nobody@example.com', 'password': DEFAULT_PASSWORD}
        )
        # Identical to wrong-password so existence cannot be probed.
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, {'status': 'invalid'})

    def test_inactive_or_unverified_user_is_blocked(self):
        create_volunteer(
            email='unverified@example.com', is_active=True, is_email_verified=False
        )
        resp = self.client.post(
            self.url,
            {'email': 'unverified@example.com', 'password': DEFAULT_PASSWORD},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, {'status': 'invalid'})

    def test_staff_login_requires_mfa_and_issues_no_session(self):
        create_staff(email='boss@example.com')
        resp = self.client.post(
            self.url, {'email': 'boss@example.com', 'password': DEFAULT_PASSWORD}
        )
        # SR-AUTH-03: staff never get a session at the password step.
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'mfa_required')
        # No authenticated session yet → /me is unauthorised.
        me = self.client.get(reverse('auth-me'))
        self.assertEqual(me.status_code, 401)

    def test_login_is_rate_limited_after_five_attempts(self):
        # SR-AUTH-04: 5 attempts / 15 min per IP → 6th is throttled.
        for _ in range(5):
            resp = self.client.post(
                self.url, {'email': 'vol@example.com', 'password': 'wrong'}
            )
            self.assertNotEqual(resp.status_code, 429)
        throttled = self.client.post(
            self.url, {'email': 'vol@example.com', 'password': 'wrong'}
        )
        self.assertEqual(throttled.status_code, 429)


class MfaTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.login_url = reverse('auth-login')
        self.verify_url = reverse('auth-mfa-verify')
        self.staff = create_staff(email='mfa-staff@example.com')
        self.device = add_confirmed_totp_device(self.staff)

    def _begin_login(self, client=None):
        client = client or self.client
        resp = client.post(
            self.login_url,
            {'email': 'mfa-staff@example.com', 'password': DEFAULT_PASSWORD},
        )
        self.assertEqual(resp.data['status'], 'mfa_required')
        return client

    def test_valid_totp_completes_login(self):
        self._begin_login()
        resp = self.client.post(self.verify_url, {'code': current_totp(self.device)})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'success')
        # Session now established.
        me = self.client.get(reverse('auth-me'))
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data['role'], User.Role.STAFF)

    def test_totp_replay_is_rejected(self):
        # django_otp advances last_t on success, so the same code cannot be reused.
        code = current_totp(self.device)
        self.assertTrue(self.device.verify_token(code))
        self.assertFalse(self.device.verify_token(code))

    def test_backup_code_is_single_use(self):
        raw_codes = _generate_backup_codes(self.staff)
        code = raw_codes[0]

        # First use mid-login → success.
        self._begin_login()
        first = self.client.post(self.verify_url, {'backup_code': code})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data['status'], 'success')

        # Re-using the same backup code on a fresh login → rejected.
        fresh = APIClient()
        self._begin_login(client=fresh)
        second = fresh.post(self.verify_url, {'backup_code': code})
        self.assertEqual(second.status_code, 400)


class PasswordResetTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.request_url = reverse('auth-password-reset-request')
        self.confirm_url = reverse('auth-password-reset-confirm')
        self.login_url = reverse('auth-login')
        self.user = create_volunteer(email='reset@example.com')

    def _request_token(self):
        self.client.post(self.request_url, {'email': 'reset@example.com'})
        body = mail.outbox[-1].body
        match = re.search(r'reset-password\?token=([^\s]+)', body)
        self.assertIsNotNone(match, 'Reset email did not contain a token link')
        return match.group(1)

    def test_request_is_generic_for_unknown_email(self):
        resp = self.client.post(self.request_url, {'email': 'nobody@example.com'})
        # Anti-enumeration: same generic 200 whether or not the email exists.
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_reset_token_is_single_use(self):
        token = self._request_token()
        first = self.client.post(
            self.confirm_url, {'token': token, 'new_password': 'BrandNew-Passphrase99'}
        )
        self.assertEqual(first.status_code, 200)

        # Re-using the same token must fail (used_at is set).
        second = self.client.post(
            self.confirm_url, {'token': token, 'new_password': 'Another-Passphrase99'}
        )
        self.assertEqual(second.status_code, 400)

    def test_password_change_invalidates_existing_sessions(self):
        # Log in on one client and confirm the session works.
        session_client = APIClient()
        session_client.post(
            self.login_url, {'email': 'reset@example.com', 'password': DEFAULT_PASSWORD}
        )
        self.assertEqual(session_client.get(reverse('auth-me')).status_code, 200)

        # Reset the password via a separate, anonymous client.
        token = self._request_token()
        self.client.post(
            self.confirm_url, {'token': token, 'new_password': 'Rotated-Passphrase99'}
        )

        # The previously-authenticated session is now rejected.
        self.assertEqual(session_client.get(reverse('auth-me')).status_code, 401)

    def test_weak_new_password_is_rejected(self):
        token = self._request_token()
        resp = self.client.post(
            self.confirm_url, {'token': token, 'new_password': 'short'}
        )
        self.assertEqual(resp.status_code, 400)


class MFAResetFlowTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.request_url = reverse('auth-mfa-reset-request')
        self.resolve_url_template = 'staff-mfa-reset-resolve'
        self.volunteer = create_volunteer(email='lost-mfa@example.com')
        self.staff = create_staff(email='resolver@example.com')
        self.superuser = User.objects.create_superuser(
            email='admin@example.com',
            password=DEFAULT_PASSWORD,
            full_name='Admin User',
        )

    def test_user_can_request_reset_and_it_is_audited(self):
        self.assertEqual(
            self.client.post(
                self.request_url,
                {'email': 'lost-mfa@example.com', 'password': DEFAULT_PASSWORD},
            ).status_code,
            200,
        )
        request_obj = MFAResetRequest.objects.get(requester=self.volunteer)
        self.assertEqual(request_obj.status, MFAResetRequest.Status.PENDING)
        self.assertTrue(
            AuditLogEntry.objects.filter(action='auth.mfa.reset.requested', target_id=str(request_obj.pk)).exists()
        )

    def test_request_response_is_generic_and_leaks_no_request_id(self):
        # Valid and invalid credentials must return an identical body so the
        # endpoint cannot be used as a credential/account enumeration oracle.
        valid = self.client.post(
            self.request_url,
            {'email': 'lost-mfa@example.com', 'password': DEFAULT_PASSWORD},
        )
        invalid = self.client.post(
            self.request_url,
            {'email': 'lost-mfa@example.com', 'password': 'wrong-password-123'},
        )
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(invalid.status_code, 200)
        self.assertNotIn('request_id', valid.data)
        self.assertEqual(valid.data, invalid.data)
        # Only the valid request creates a row.
        self.assertEqual(MFAResetRequest.objects.filter(requester=self.volunteer).count(), 1)

    def test_staff_can_resolve_volunteer_reset_and_it_is_audited(self):
        device = add_confirmed_totp_device(self.volunteer)
        _generate_backup_codes(self.volunteer)
        request_obj = MFAResetRequest.objects.create(
            requester=self.volunteer,
            target_user=self.volunteer,
            reason='lost_authenticator',
        )

        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(
            reverse(self.resolve_url_template, args=[request_obj.pk]),
            {
                'verification_method': 'phone callback to registered number',
                'verification_outcome': 'identity matched',
            },
        )
        self.assertEqual(resp.status_code, 200)

        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, MFAResetRequest.Status.RESOLVED)
        self.assertEqual(request_obj.verification_method, 'phone callback to registered number')
        self.assertFalse(device.__class__.objects.filter(user=self.volunteer).exists())
        self.assertEqual(self.volunteer.mfa_backup_codes.filter(used_at__isnull=True).count(), 0)
        self.assertTrue(
            AuditLogEntry.objects.filter(action='auth.mfa.reset.completed', target_id=str(request_obj.pk)).exists()
        )

    def test_staff_resolve_requires_verification_details(self):
        request_obj = MFAResetRequest.objects.create(
            requester=self.volunteer,
            target_user=self.volunteer,
            reason='lost_authenticator',
        )
        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(reverse(self.resolve_url_template, args=[request_obj.pk]), {})
        self.assertEqual(resp.status_code, 400)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, MFAResetRequest.Status.PENDING)

    def test_staff_cannot_reset_another_staff_mfa(self):
        # §10.1.2 / FR-S-08: non-admin staff may reset volunteers only; a peer
        # staff target requires an admin actor.
        target_staff = create_staff(email='peer-staff@example.com')
        device = add_confirmed_totp_device(target_staff)
        request_obj = MFAResetRequest.objects.create(
            requester=target_staff,
            target_user=target_staff,
            reason='lost_authenticator',
        )
        self.client.force_authenticate(user=self.staff)
        resp = self.client.post(
            reverse(self.resolve_url_template, args=[request_obj.pk]),
            {'verification_method': 'phone callback', 'verification_outcome': 'identity matched'},
        )
        self.assertEqual(resp.status_code, 403)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, MFAResetRequest.Status.PENDING)
        # The target's MFA device must remain intact.
        self.assertTrue(device.__class__.objects.filter(user=target_staff).exists())

    def test_admin_fallback_requires_out_of_band_verification_details(self):
        request_obj = MFAResetRequest.objects.create(
            requester=self.volunteer,
            target_user=self.volunteer,
            reason='lost_authenticator',
        )

        self.client.force_authenticate(user=self.superuser)
        missing = self.client.post(reverse(self.resolve_url_template, args=[request_obj.pk]), {})
        self.assertEqual(missing.status_code, 400)

        ok = self.client.post(
            reverse(self.resolve_url_template, args=[request_obj.pk]),
            {
                'verification_method': 'phone callback to registered number',
                'verification_outcome': 'identity matched',
            },
        )
        self.assertEqual(ok.status_code, 200)

        request_obj.refresh_from_db()
        self.assertEqual(request_obj.reviewed_by, self.superuser)
        self.assertEqual(request_obj.verification_method, 'phone callback to registered number')
        self.assertEqual(request_obj.verification_outcome, 'identity matched')
        audit = AuditLogEntry.objects.get(action='auth.mfa.reset.completed', target_id=str(request_obj.pk))
        self.assertEqual(audit.metadata['verification_method'], 'phone callback to registered number')
        self.assertEqual(audit.metadata['verification_outcome'], 'identity matched')


class RegistrationTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.url = reverse('auth-register')

    def test_valid_registration_creates_unverified_user_and_sends_email(self):
        resp = self.client.post(
            self.url,
            {
                'email': 'newbie@example.com',
                'full_name': 'New Bie',
                'password': 'Valid-Passphrase123',
            },
        )
        self.assertEqual(resp.status_code, 200)
        user = User.objects.get(email='newbie@example.com')
        self.assertFalse(user.is_email_verified)
        self.assertEqual(user.role, User.Role.VOLUNTEER)
        self.assertEqual(len(mail.outbox), 1)

    def test_weak_password_is_rejected(self):
        resp = self.client.post(
            self.url,
            {'email': 'weak@example.com', 'full_name': 'Weak Pw', 'password': '123'},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('password', resp.data)
        self.assertFalse(User.objects.filter(email='weak@example.com').exists())

    def test_duplicate_email_does_not_create_second_user_or_leak(self):
        create_volunteer(email='dupe@example.com')
        resp = self.client.post(
            self.url,
            {
                'email': 'dupe@example.com',
                'full_name': 'Imposter',
                'password': 'Valid-Passphrase123',
            },
        )
        # SR-AUTH-06: generic 200, and no second account created.
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(User.objects.filter(email='dupe@example.com').count(), 1)


class EmailVerificationTests(KakiCareAPITestCase):
    def setUp(self):
        super().setUp()
        self.url = reverse('auth-verify-email')
        self.user = create_volunteer(
            email='verifyme@example.com', is_email_verified=False
        )

    def _make_token(self):
        raw = 'raw-verification-token-value'
        EmailVerificationToken.objects.create(
            user=self.user,
            token_hash=_hash_token(raw),
            expires_at=timezone.now() + timedelta(hours=24),
        )
        return raw

    def test_valid_token_verifies_email(self):
        raw = self._make_token()
        resp = self.client.post(self.url, {'token': raw})
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_email_verified)

    def test_reused_token_is_rejected(self):
        raw = self._make_token()
        self.client.post(self.url, {'token': raw})
        second = self.client.post(self.url, {'token': raw})
        self.assertEqual(second.status_code, 400)

    def test_only_token_hash_is_stored_never_raw(self):
        raw = self._make_token()
        # No reset tokens leaked into this flow.
        self.assertEqual(PasswordResetToken.objects.count(), 0)
        token_obj = EmailVerificationToken.objects.get(user=self.user)
        self.assertNotEqual(token_obj.token_hash, raw)
        self.assertEqual(token_obj.token_hash, _hash_token(raw))


class ResendVerificationTests(KakiCareAPITestCase):
    """Self-service recovery for a lost/expired verification email."""

    def setUp(self):
        super().setUp()
        self.url = reverse('auth-resend-verification')
        self.user = create_volunteer(
            email='unverified@example.com', is_email_verified=False
        )

    def test_resend_issues_new_token_and_sends_email(self):
        resp = self.client.post(self.url, {'email': 'unverified@example.com'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(
            EmailVerificationToken.objects.filter(
                user=self.user, used_at__isnull=True
            ).count(),
            1,
        )

    def test_resend_expires_previous_outstanding_token(self):
        # An earlier (e.g. lost) verification token is outstanding.
        old = EmailVerificationToken.objects.create(
            user=self.user,
            token_hash=_hash_token('old-token'),
            expires_at=timezone.now() + timedelta(hours=24),
        )
        resp = self.client.post(self.url, {'email': 'unverified@example.com'})
        self.assertEqual(resp.status_code, 200)
        old.refresh_from_db()
        # Old link is invalidated so only one live link ever exists.
        self.assertIsNotNone(old.used_at)
        self.assertEqual(
            EmailVerificationToken.objects.filter(
                user=self.user, used_at__isnull=True
            ).count(),
            1,
        )

    def test_already_verified_email_is_a_noop_but_generic_200(self):
        verified = create_volunteer(
            email='done@example.com', is_email_verified=True
        )
        resp = self.client.post(self.url, {'email': 'done@example.com'})
        # SR-AUTH-06: identical generic response, but no email/token issued.
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(
            EmailVerificationToken.objects.filter(user=verified).count(), 0
        )

    def test_unknown_email_is_a_noop_but_generic_200(self):
        resp = self.client.post(self.url, {'email': 'nobody@example.com'})
        # SR-AUTH-06: cannot distinguish unknown from known/unverified.
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)


class StaffInviteTests(KakiCareAPITestCase):
    """Staff onboarding via emailed invite (admin provisions -> staff sets password)."""

    def setUp(self):
        super().setUp()
        self.accept_url = reverse('auth-accept-invite')
        self.login_url = reverse('auth-login')
        # Mirror how the admin creates a staff account: inactive, unverified,
        # no usable password, no Django-admin access.
        self.user = User.objects.create_user(
            email='newstaff@example.com',
            password=None,  # set_unusable_password under the hood
            full_name='New Staff',
            role=User.Role.STAFF,
            is_active=False,
            is_email_verified=False,
        )

    def _issue_token(self):
        issue_and_send_staff_invite(self.user)
        body = mail.outbox[-1].body
        match = re.search(r'accept-invite\?token=([^\s]+)', body)
        self.assertIsNotNone(match, 'Invite email did not contain a token link')
        return match.group(1)

    def test_invite_email_links_to_public_accept_path(self):
        issue_and_send_staff_invite(self.user)
        self.assertEqual(len(mail.outbox), 1)
        body = mail.outbox[-1].body
        # Public path, NOT the auth-gated /staff tree.
        self.assertIn('/accept-invite?token=', body)
        self.assertNotIn('/staff/accept-invite', body)

    def test_accept_sets_password_and_activates_account(self):
        token = self._issue_token()
        resp = self.client.post(
            self.accept_url, {'token': token, 'new_password': 'Brand-New-Passphrase99'}
        )
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)
        self.assertTrue(self.user.is_email_verified)
        self.assertTrue(self.user.has_usable_password())
        self.assertTrue(self.user.check_password('Brand-New-Passphrase99'))

    def test_accepted_staff_then_requires_mfa_at_login(self):
        token = self._issue_token()
        self.client.post(
            self.accept_url, {'token': token, 'new_password': 'Brand-New-Passphrase99'}
        )
        resp = self.client.post(
            self.login_url,
            {'email': 'newstaff@example.com', 'password': 'Brand-New-Passphrase99'},
        )
        # SR-AUTH-03: staff always gated behind MFA; no session issued here.
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['status'], 'mfa_required')

    def test_invite_token_is_single_use(self):
        token = self._issue_token()
        first = self.client.post(
            self.accept_url, {'token': token, 'new_password': 'Brand-New-Passphrase99'}
        )
        self.assertEqual(first.status_code, 200)
        second = self.client.post(
            self.accept_url, {'token': token, 'new_password': 'Another-Passphrase99'}
        )
        self.assertEqual(second.status_code, 400)

    def test_reissuing_invite_invalidates_the_previous_token(self):
        first_token = self._issue_token()
        second_token = self._issue_token()  # acts as a "resend"
        self.assertNotEqual(first_token, second_token)
        # The superseded token must no longer work.
        stale = self.client.post(
            self.accept_url, {'token': first_token, 'new_password': 'Brand-New-Passphrase99'}
        )
        self.assertEqual(stale.status_code, 400)
        # The latest token still works.
        ok = self.client.post(
            self.accept_url, {'token': second_token, 'new_password': 'Brand-New-Passphrase99'}
        )
        self.assertEqual(ok.status_code, 200)

    def test_weak_password_is_rejected_and_account_stays_inactive(self):
        token = self._issue_token()
        resp = self.client.post(
            self.accept_url, {'token': token, 'new_password': 'short'}
        )
        self.assertEqual(resp.status_code, 400)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
        self.assertFalse(self.user.has_usable_password())

    def test_invalid_token_returns_generic_400(self):
        resp = self.client.post(
            self.accept_url,
            {'token': 'not-a-real-token', 'new_password': 'Brand-New-Passphrase99'},
        )
        self.assertEqual(resp.status_code, 400)

    def test_only_token_hash_is_stored_never_raw(self):
        token = self._issue_token()
        token_obj = StaffInviteToken.objects.get(user=self.user, used_at__isnull=True)
        self.assertNotEqual(token_obj.token_hash, token)
        self.assertEqual(token_obj.token_hash, _hash_token(token))
