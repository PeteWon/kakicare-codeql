"""Custom password validators for KakiCare.

SR-AUTH-02: passwords are screened against the Have I Been Pwned breach corpus
using the k-anonymity range API. Only the first 5 characters of the SHA-1 hash
are sent to HIBP — the full hash and the plaintext password never leave the
server.

Failure behaviour: if the HIBP API is unreachable (network error, timeout),
the validator fails OPEN — the password is accepted and a warning is logged.
This avoids blocking legitimate users during third-party outages at the cost of
occasionally admitting a breached password that would otherwise be caught. The
Django CommonPasswordValidator (~20k list) still runs and provides a baseline
even when HIBP is unavailable.
"""

import hashlib
import logging
import urllib.error
import urllib.request

from django.core.exceptions import ValidationError

logger = logging.getLogger(__name__)

_HIBP_API_URL = 'https://api.pwnedpasswords.com/range/{prefix}'
_HIBP_TIMEOUT = 3  # seconds — keeps registration latency acceptable
_USER_AGENT = 'KakiCare-PasswordCheck/1.0'


class HIBPPasswordValidator:
    """Reject passwords found in the Have I Been Pwned breach corpus.

    Uses the k-anonymity range API: only a 5-character SHA-1 prefix is sent,
    so neither the plaintext password nor the full hash is disclosed to HIBP.
    """

    def validate(self, password, user=None):
        sha1 = hashlib.sha1(password.encode('utf-8')).hexdigest().upper()
        prefix, suffix = sha1[:5], sha1[5:]

        try:
            req = urllib.request.Request(
                _HIBP_API_URL.format(prefix=prefix),
                headers={'User-Agent': _USER_AGENT},
            )
            with urllib.request.urlopen(req, timeout=_HIBP_TIMEOUT) as response:
                body = response.read().decode('utf-8')
        except Exception:
            # Fail open: network errors must not block registration or password
            # reset. Log so ops can detect sustained HIBP unavailability.
            logger.warning('HIBP API unreachable — skipping breach check')
            return

        for line in body.splitlines():
            parts = line.split(':')
            if len(parts) != 2:
                continue
            response_suffix, count_str = parts
            if response_suffix.upper() == suffix:
                try:
                    count = int(count_str)
                except ValueError:
                    continue
                if count > 0:
                    raise ValidationError(
                        'This password has appeared in a data breach. '
                        'Please choose a different password.',
                        code='password_breached',
                    )

    def get_help_text(self):
        return (
            'Your password must not have appeared in a known data breach.'
        )
