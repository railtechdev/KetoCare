"""Encryption of secrets the administrator types in the cabinet (ADR-0080).

Fernet (AES-128-CBC with HMAC-SHA256, `cryptography`): a standard construction,
not a home-made one. The point is a copy of the database — a backup, a dump for
an incident review — that does not carry the provider key in the clear. The
encryption key lives in the environment and never in the database.

The key is `SETTINGS_ENCRYPTION_KEY` when it is set, otherwise derived from
`SECRET_KEY` with HKDF under a label of its own, so the two never coincide.
A value encrypted under another key is not an error of the application: it
reads as "absent", and the environment fallback takes over until the
administrator types the secret again.
"""

from __future__ import annotations

import base64
from typing import Literal

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .config import Settings

KeySource = Literal["dedicated", "derived"]

_HKDF_INFO = b"ketocare/app-settings/v1"


class BadEncryptionKey(ValueError):
    """`SETTINGS_ENCRYPTION_KEY` is set but is not a Fernet key."""


def key_source(settings: Settings) -> KeySource:
    return "dedicated" if settings.settings_encryption_key.strip() else "derived"


def _fernet(settings: Settings) -> Fernet:
    dedicated = settings.settings_encryption_key.strip()
    if dedicated:
        try:
            return Fernet(dedicated.encode())
        except ValueError as error:
            raise BadEncryptionKey(
                "SETTINGS_ENCRYPTION_KEY должен быть ключом Fernet: 32 байта в urlsafe base64."
            ) from error
    derived = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_HKDF_INFO).derive(
        settings.secret_key.encode()
    )
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt(settings: Settings, plain: str) -> str:
    return _fernet(settings).encrypt(plain.encode()).decode()


def decrypt(settings: Settings, token: str) -> str | None:
    """The secret, or `None` when it was encrypted under another key."""

    try:
        return _fernet(settings).decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def hint(secret: str) -> str:
    """What the cabinet shows of a secret: its last four characters."""

    tail = secret.strip()[-4:]
    return f"…{tail}" if tail else ""
