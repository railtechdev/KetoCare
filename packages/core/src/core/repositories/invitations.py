"""Приглашения пользователей (раздел 5.3 ТЗ: `POST /auth/invitations`).

В БД хранится только хеш токена — сам токен показывается администратору один раз
и уходит приглашаемому по почте. Компрометация дампа БД не даёт принять приглашение.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Invitation
from ..models.enums import UserRole

INVITATION_TTL = timedelta(days=7)


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create(session: AsyncSession, *, email: str, role: UserRole, token: str) -> Invitation:
    invitation = Invitation(
        email=email,
        role=role,
        token_hash=hash_token(token),
        expires_at=datetime.now(UTC) + INVITATION_TTL,
    )
    session.add(invitation)
    await session.flush()
    return invitation


async def get_valid_by_token(session: AsyncSession, token: str) -> Invitation | None:
    """Возвращает приглашение только если оно не принято и не истекло."""

    stmt = select(Invitation).where(Invitation.token_hash == hash_token(token))
    invitation: Invitation | None = await session.scalar(stmt)

    if invitation is None or invitation.accepted_at is not None:
        return None
    if invitation.expires_at <= datetime.now(UTC):
        return None
    return invitation


async def mark_accepted(session: AsyncSession, *, invitation: Invitation) -> Invitation:
    invitation.accepted_at = datetime.now(UTC)
    await session.flush()
    return invitation


async def get(session: AsyncSession, invitation_id: uuid.UUID) -> Invitation | None:
    return await session.get(Invitation, invitation_id)
