"""Репозиторий учётных записей."""

from __future__ import annotations

import uuid
from collections.abc import Collection, Sequence
from typing import Any

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


async def list_active_by_roles(session: AsyncSession, *, roles: Sequence[UserRole]) -> list[User]:
    """Активные учётные записи указанных ролей, по алфавиту.

    Нужна справочником персонала: чтобы передать пациента коллеге, врач должен
    коллегу выбрать. Клинических данных здесь нет — имя, роль, идентификатор.
    """

    stmt = (
        select(User).where(User.role.in_(roles), User.is_active.is_(True)).order_by(User.full_name)
    )
    return list(await session.scalars(stmt))


async def update(session: AsyncSession, *, user: User, **fields: Any) -> User:
    """Применяет уже проверенный набор изменений к учётной записи.

    Какие поля вообще можно менять и кому — решает вызывающая сторона: репозиторий
    не знает про роли. Пустой `fields` допустим и означает «ничего не менять».
    """

    for key, value in fields.items():
        setattr(user, key, value)
    await session.flush()
    return user


async def names_by_ids(
    session: AsyncSession, *, user_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Имена по идентификаторам — одним запросом.

    Нужна там, где рядом со списком записей надо назвать автора: идентификатор
    без имени отвечает «кто-то», а вопрос «кто это поменял» задают после
    инцидента, и ответ нужен сразу.
    """

    if not user_ids:
        return {}

    rows = await session.execute(select(User.id, User.full_name).where(User.id.in_(list(user_ids))))
    return {row.id: row.full_name for row in rows}
