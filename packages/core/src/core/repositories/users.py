"""Репозиторий учётных записей."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import User
from ..models.enums import UserRole


async def get(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await session.get(User, user_id)


async def get_by_email(session: AsyncSession, email: str) -> User | None:
    """email — citext, поэтому сравнение регистронезависимое на уровне БД."""

    result: User | None = await session.scalar(select(User).where(User.email == email))
    return result


async def create(
    session: AsyncSession,
    *,
    role: UserRole,
    full_name: str,
    email: str,
    password_hash: str,
    phone: str | None = None,
    invited_by: uuid.UUID | None = None,
) -> User:
    user = User(
        role=role,
        full_name=full_name,
        email=email,
        password_hash=password_hash,
        phone=phone,
        invited_by=invited_by,
    )
    session.add(user)
    await session.flush()
    return user


async def list_all(
    session: AsyncSession, *, limit: int = 50, offset: int = 0
) -> tuple[list[User], int]:
    stmt = select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    items = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(User))
    return items, int(total or 0)
