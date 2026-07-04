from cryptography.fernet import Fernet
from django.conf import settings


def _fernet() -> Fernet:
    key = settings.TOTP_ENCRYPTION_KEY
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def encrypt_totp_key(plaintext_hex: str) -> str:
    return _fernet().encrypt(plaintext_hex.encode()).decode()


def decrypt_totp_key(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()
