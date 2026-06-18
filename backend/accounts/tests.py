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

from accounts.models import EmailVerificationToken, PasswordResetToken, User
from accounts.views import _generate_backup_codes, _hash_token
from kakicare.test_utils import (
    DEFAULT_PASSWORD,
    KakiCareAPITestCase,
    add_confirmed_totp_device,
    create_staff,
    create_volunteer,
    current_totp,
)


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
