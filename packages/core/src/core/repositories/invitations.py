"""Приглашения пользователей (раздел 5.3 ТЗ: `POST /auth/invitations`).

В БД хранится только хеш токена — сам токен показывается администратору один раз
и уходит приглашаемому по почте. Компрометация дампа БД не даёт принять приглашение.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
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
            # Отозванное приглашение не принимается: иначе отзыв означал бы
            # только «пропало из списка», а ссылка продолжала бы работать.
            Invitation.revoked_at.is_(None),
            Invitation.expires_at > now,
        )
        .values(accepted_at=now)
        .returning(Invitation)
    )
    result: Invitation | None = await session.scalar(stmt)
    return result


async def get(session: AsyncSession, invitation_id: uuid.UUID) -> Invitation | None:
    return await session.get(Invitation, invitation_id)


async def list_invitations(
    session: AsyncSession,
    *,
    created_by: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Invitation], int]:
    """Выданные приглашения, новые сверху.

    `created_by` сужает выборку до своих: администратор видит все, врач и
    диетолог — только те, что выдали сами. Чужие приглашения им не нужны, а
    список адресов чужих семей — это сведения о пациентах другого специалиста.
    """

    conditions = [] if created_by is None else [Invitation.created_by == created_by]

    stmt = (
        select(Invitation)
        .where(*conditions)
        .order_by(Invitation.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list(await session.scalars(stmt))

    total = await session.scalar(select(func.count()).select_from(Invitation).where(*conditions))
    return items, int(total or 0)


async def revoke(session: AsyncSession, *, invitation: Invitation) -> Invitation:
    """Гасит приглашение. Принятое не гасится: учётная запись уже создана."""

    invitation.revoked_at = datetime.now(UTC)
    await session.flush()
    return invitation
