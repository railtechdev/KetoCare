"""Стандарты питания (ADR-0056, ADR-0057)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import FoodStandard, Product
from ..models.enums import CarbsConvention, FoodDietType, FoodStandardKind


class StandardAlreadyLockedError(Exception):
    """Стандарт уже закрыт: закрытие необратимо, и второго раза не бывает."""


async def get(session: AsyncSession, standard_id: uuid.UUID) -> FoodStandard | None:
    return await session.get(FoodStandard, standard_id)


async def list_all(session: AsyncSession, *, include_inactive: bool = False) -> list[FoodStandard]:
    """Все стандарты: открытые раньше закрытых, внутри — по названию.

    Основной стандарт клиники идёт первым не по названию, а по роли: с него
    начинается любой список выбора.
    """

    stmt = select(FoodStandard)
    if not include_inactive:
        stmt = stmt.where(FoodStandard.is_active.is_(True))
    stmt = stmt.order_by(
        FoodStandard.locked_at.is_not(None),
        FoodStandard.kind != FoodStandardKind.CLINIC,
        FoodStandard.created_at,
        FoodStandard.name,
    )
    return list(await session.scalars(stmt))


async def count_products(session: AsyncSession) -> dict[uuid.UUID, int]:
    """Сколько позиций в каждом стандарте — одним запросом на весь список."""

    rows = await session.execute(
        select(Product.standard_id, func.count()).group_by(Product.standard_id)
    )
    return {standard_id: int(count) for standard_id, count in rows}


async def find_by_name(
    session: AsyncSession, *, name: str, exclude_id: uuid.UUID | None = None
) -> FoodStandard | None:
    """Как и индекс: без учёта регистра и внешних пробелов."""

    conditions = [func.lower(func.btrim(FoodStandard.name)) == name.casefold().strip()]
    if exclude_id is not None:
        conditions.append(FoodStandard.id != exclude_id)
    standard: FoodStandard | None = await session.scalar(
        select(FoodStandard).where(*conditions).limit(1)
    )
    return standard


async def create(
    session: AsyncSession,
    *,
    name: str,
    kind: FoodStandardKind,
    diet_type: FoodDietType,
    carbs_convention: CarbsConvention,
    publisher: str | None = None,
    document: str | None = None,
    version: str | None = None,
    effective_on: date | None = None,
) -> FoodStandard:
    standard = FoodStandard(
        name=name,
        kind=kind,
        diet_type=diet_type,
        carbs_convention=carbs_convention,
        publisher=publisher,
        document=document,
        version=version,
        effective_on=effective_on,
    )
    session.add(standard)
    await session.flush()
    return standard


async def update(session: AsyncSession, *, standard: FoodStandard, **fields: Any) -> FoodStandard:
    """Описание стандарта. Вид, тип диеты и конвенция углеводов не меняются:
    от них зависит, как прочитаны уже заведённые значения."""

    for key, value in fields.items():
        setattr(standard, key, value)
    await session.flush()
    return standard


async def lock(session: AsyncSession, *, standard: FoodStandard) -> FoodStandard:
    # Эксклюзивная блокировка дожидается начатых записей значений, а значит
    # после этой строки в стандарт уже никто не запишет (`products._unlocked_standard`).
    await session.refresh(standard, with_for_update=True)
    if standard.locked_at is not None:
        raise StandardAlreadyLockedError(str(standard.id))
    standard.locked_at = datetime.now(UTC)
    await session.flush()
    return standard
