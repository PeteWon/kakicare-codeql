"""Application-layer encrypted model fields (SR-DATA-05).

Sensitive Senior PII (home address, phone number, next-of-kin name/contact) is
encrypted in the application before being written to the database and decrypted
on read, so the raw values never appear in a database dump. Encryption is
transparent to the rest of the stack: serializers, views and the admin read and
write plaintext via normal attribute access; only the stored column holds
ciphertext.

Mechanism: Fernet (AES-128-CBC + HMAC) with a dedicated key
(settings.FIELD_ENCRYPTION_KEY), mirroring the TOTP-secret-at-rest approach in
accounts/encryption.py.

Consequences (documented deliberately):
  - Ciphertext is not substring-searchable, so these fields cannot back a SQL
    LIKE/icontains query (see seniors.views senior search — it matches on
    full_name only).
  - Ciphertext is longer than plaintext, so encrypted fields are stored in TEXT
    columns regardless of the logical input length (input length is still
    validated in the serializer, SR-INPUT-01).
"""

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models


def _fernet() -> Fernet:
    key = settings.FIELD_ENCRYPTION_KEY
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


class EncryptedTextField(models.TextField):
    """A TextField whose value is Fernet-encrypted at rest.

    Empty/NULL values are stored as-is (no ciphertext for empty strings) so
    blank=True semantics are preserved. On read, a value that fails to decrypt
    is returned unchanged — this tolerates rows written as plaintext before the
    field was encrypted; the accompanying data migration re-saves such rows to
    encrypt them.
    """

    def from_db_value(self, value, expression, connection):
        if value is None or value == '':
            return value
        try:
            return _fernet().decrypt(value.encode()).decode()
        except InvalidToken:
            # Legacy plaintext written before encryption was enabled.
            return value

    def get_prep_value(self, value):
        value = super().get_prep_value(value)
        if value is None or value == '':
            return value
        return _fernet().encrypt(value.encode()).decode()
