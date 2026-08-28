"""Репозиторий своих блюд родителя (раздел 4.2, 5.3 ТЗ).

Мягкое удаление: клинические и дневниковые записи физически не удаляются
(правило 4 CLAUDE.md), выборки по умолчанию отсекают `deleted_at is not null`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import CustomDish


async def get(session: AsyncSession, dish_id: uuid.UUID) -> CustomDish | None:
    """Возвращает блюдо, если оно не удалено мягко."""

    dish: CustomDish | None = await session.scalar(
        select(CustomDish).where(CustomDish.id == dish_id, CustomDish.deleted_at.is_(None))
    )
    return dish


async def list_for_patient(
    session: AsyncSession, *, patient_id: uuid.UUID, limit: int = 50, offset: int = 0
) -> tuple[list[CustomDish], int]:
    condition = (CustomDish.patient_id == patient_id, CustomDish.deleted_at.is_(None))

    stmt = (
        select(CustomDish)
        .where(*condition)
        .order_by(CustomDish.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(CustomDish).where(*condition))
    return items, int(total or 0)


async def create(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    title: str,
    ingredients: list[dict[str, Any]],
    computed: dict[str, Any],
    engine_version: str,
) -> CustomDish:
    dish = CustomDish(
        patient_id=patient_id,
        title=title,
        ingredients=ingredients,
        computed=computed,
        engine_version=engine_version,
    )
    session.add(dish)
    await session.flush()
    return dish


async def update(
    session: AsyncSession,
    *,
    dish: CustomDish,
    title: str,
    ingredients: list[dict[str, Any]],
    computed: dict[str, Any],
    engine_version: str,
) -> CustomDish:
    """Пересчитанные значения сохраняются вместе с версией движка (раздел 4.1 ТЗ):
    без неё нельзя отличить, каким кодом получен сохранённый результат."""

    dish.title = title
    dish.ingredients = ingredients
    dish.computed = computed
    dish.engine_version = engine_version
    await session.flush()
    return dish


async def soft_delete(session: AsyncSession, *, dish: CustomDish) -> CustomDish:
    dish.deleted_at = datetime.now(UTC)
    await session.flush()
    return dish
