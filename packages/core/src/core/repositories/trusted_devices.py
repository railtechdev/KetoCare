"""Remembered devices: the second factor is not asked again for 30 days (ADR-0061).

The browser keeps a random token; the database keeps its sha256 and a binding to
the user's current password and second factor. Changing either one makes every
remembered device invalid without a separate hook in each place that changes them.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TrustedDevice, User

TRUSTED_DEVICE_TTL = timedelta(days=30)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def binding_of(user: User) -> str:
    """Fingerprint of the credentials the device was trusted under."""

    return _digest(f"{user.password_hash or ''}\0{user.totp_secret or ''}")


async def remember(session: AsyncSession, *, user: User, user_agent: str | None) -> str:
    """Trust this device; returns the raw token for the cookie."""

    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    session.add(
        TrustedDevice(
            user_id=user.id,
            token_hash=_digest(token),
            binding=binding_of(user),
            expires_at=now + TRUSTED_DEVICE_TTL,
            last_used_at=now,
            user_agent=(user_agent or "")[:255] or None,
        )
    )
    await session.flush()
    return token


async def is_trusted(session: AsyncSession, *, user: User, token: str | None) -> bool:
    if not token:
        return False
    now = datetime.now(UTC)
    device = await session.scalar(
        select(TrustedDevice).where(
            TrustedDevice.token_hash == _digest(token),
            TrustedDevice.user_id == user.id,
            TrustedDevice.revoked_at.is_(None),
            TrustedDevice.expires_at > now,
        )
    )
    if device is None or not secrets.compare_digest(device.binding, binding_of(user)):
        return False
    device.last_used_at = now
    await session.flush()
    return True


async def forget_all(session: AsyncSession, *, user_id: uuid.UUID) -> int:
    result = await session.execute(
        update(TrustedDevice)
        .where(TrustedDevice.user_id == user_id, TrustedDevice.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    return int(getattr(result, "rowcount", 0) or 0)
