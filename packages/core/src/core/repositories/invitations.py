"""Приглашения пользователей (раздел 5.3 ТЗ: `POST /auth/invitations`).

В БД хранится только хеш токена — сам токен показывается администратору один раз
и уходит приглашаемому по почте. Компрометация дампа БД не даёт принять приглашение.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Invitation
from ..models.enums import UserRole

INVITATION_TTL = timedelta(days=7)


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create(
    session: AsyncSession,
    *,
    email: str,
    role: UserRole,
    token: str,
    created_by: uuid.UUID | None = None,
) -> Invitation:
    invitation = Invitation(
        email=email,
        role=role,
        token_hash=hash_token(token),
        expires_at=datetime.now(UTC) + INVITATION_TTL,
        created_by=created_by,
    )
    session.add(invitation)
    await session.flush()
    return invitation


async def claim(session: AsyncSession, token: str) -> Invitation | None:
    """Атомарно помечает приглашение принятым и возвращает его.

    Проверка «не принято и не истекло» и сама отметка выполняются одним UPDATE
    с условием `accepted_at IS NULL`: при двух параллельных запросах с одним
    токеном строку получит ровно один, второй увидит None. Раздельные
    get + update допускали бы гонку (оба проходят проверку).
    """

    now = datetime.now(UTC)
    stmt = (
        update(Invitation)
        .where(
            Invitation.token_hash == hash_token(token),
            Invitation.accepted_at.is_(None),
            Invitation.expires_at > now,
        )
        .values(accepted_at=now)
        .returning(Invitation)
    )
    result: Invitation | None = await session.scalar(stmt)
    return result


async def get(session: AsyncSession, invitation_id: uuid.UUID) -> Invitation | None:
    return await session.get(Invitation, invitation_id)
