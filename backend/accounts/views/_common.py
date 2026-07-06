"""Shared constants, helpers, throttles and pagination for the accounts views.

The former monolithic ``accounts/views.py`` was split into a package
(auth, mfa, password, registration, deactivation). Everything used by more than
one of those modules lives here so there is a single definition. See
``accounts/views/__init__.py`` for the public re-export surface consumed by
``accounts/urls.py``, ``accounts/staff_urls.py``, ``accounts/admin.py`` and the
test suite.
"""

import hashlib
import logging

from django.contrib.auth.hashers import make_password
from rest_framework.throttling import SimpleRateThrottle

from audit.services import get_client_ip

# Keep the original logger name so any logging configuration keyed on it is
# unaffected by the split.
logger = logging.getLogger('accounts.views')

_TOKEN_EXPIRY_HOURS = 24
_PASSWORD_RESET_EXPIRY_HOURS = 1
_STAFF_INVITE_EXPIRY_HOURS = 72
_BACKUP_CODE_COUNT = 8

_GENERIC_VERIFY_ERROR = 'Invalid or expired verification link.'
_GENERIC_LOGIN_ERROR = 'Invalid email or password.'
_GENERIC_RESET_ERROR = 'Invalid or expired reset link.'
_GENERIC_INVITE_ERROR = 'Invalid or expired invite link.'
_GENERIC_MFA_ERROR = 'Invalid or expired code.'

# SR-AUTH-06 (timing equalizer): computed once at startup. When an email is
# not found at login we still run check_password against this value so the
# Argon2id work happens and response time does not betray email existence.
_DUMMY_PASSWORD_HASH = make_password('unused-dummy-timing-value')


def _get_ip(request) -> str | None:
    # Backward-compatible alias for the single shared audit helper, kept so the
    # existing _get_ip(request) call sites are unchanged after the module split.
    return get_client_ip(request)


def _hash_token(raw_token: str) -> str:
    # SR-DATA: only the hash is stored/queried; the raw token is never persisted.
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


# ---------------------------------------------------------------------------
# Throttles (SR-AUTH-04) — applied per-view, IP-keyed
# ---------------------------------------------------------------------------

class LoginRateThrottle(SimpleRateThrottle):
    """SR-AUTH-04: 5 login attempts per 15 minutes, keyed by source IP.

    IP-keyed (not account-keyed) so an attacker cannot lock out a legitimate
    user by submitting their email in repeated requests.
    """

    scope = 'login'

    def parse_rate(self, rate):
        return (5, 15 * 60)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class MFARateThrottle(SimpleRateThrottle):
    """SR-AUTH-04: 10 MFA verify attempts per 15 minutes, keyed by source IP."""

    scope = 'mfa_verify'

    def parse_rate(self, rate):
        return (10, 15 * 60)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class PasswordResetRateThrottle(SimpleRateThrottle):
    """SR-AUTH-04: 5 password-reset requests per hour, keyed by source IP."""

    scope = 'password_reset'

    def parse_rate(self, rate):
        return (5, 3600)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class RegistrationRateThrottle(SimpleRateThrottle):
    """SR-AUTH-04: 5 registration attempts per hour, keyed by source IP.

    Each attempt triggers an outbound verification email — without a throttle
    an attacker can abuse the SMTP relay and exhaust server resources.
    """

    scope = 'register'

    def parse_rate(self, rate):
        return (5, 3600)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class ResendVerificationRateThrottle(SimpleRateThrottle):
    """SR-AUTH-04: 5 resend-verification requests per hour, keyed by source IP.

    Each request can trigger an outbound verification email — throttling (as on
    registration) stops an attacker abusing the SMTP relay.
    """

    scope = 'resend_verification'

    def parse_rate(self, rate):
        return (5, 3600)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class MFAResetRequestRateThrottle(SimpleRateThrottle):
    """SR-AUTH-04: 5 MFA-reset requests per 15 minutes, keyed by source IP.

    This endpoint verifies an email/password pair, so without a throttle it is
    an unauthenticated credential-guessing oracle that bypasses the login
    throttle. IP-keyed (not account-keyed) for the same reason as login.
    """

    scope = 'mfa_reset_request'

    def parse_rate(self, rate):
        return (5, 15 * 60)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class ContactRateThrottle(SimpleRateThrottle):
    """5 contact-form submissions per hour, keyed by source IP.

    Public and unauthenticated, and each submission sends an outbound email —
    without a throttle it is an open relay for spamming the contact inbox.
    """

    scope = 'contact'

    def parse_rate(self, rate):
        return (5, 3600)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}
