"""Репозиторий назначений — append-only (правило 4 CLAUDE.md, раздел 4.2 ТЗ).

Изменение назначения = новая строка. UPDATE/DELETE запрещены на уровне
репозитория: методов, выполняющих их, здесь нет и быть не должно.
Какое назначение действует в день D — одно правило на весь продукт
(`active_on` / `get_active_on`): из версий, начавшихся не позже D
(`effective_from <= D`), — последняя записанная. На сегодня это и есть
«последняя по created_at» раздела 4.2 ТЗ: будущую дату начала сервер не
принимает. Разные правила у сводки семьи и у сводки врача судили один и тот же
день по разным назначениям (аудит расчётов 13.11.2026).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import date

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..clock import local_today
from ..models import Prescription


async def create(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    ratio: float,
    kcal_per_day: int,
    protein_g: float,
    carbs_limit_g: float,
    meals_per_day: int,
    author_id: uuid.UUID,
    effective_from: date,
    restrictions: str | None = None,
    fluid_ml_per_day: int | None = None,
) -> Prescription:
    """Создаёт НОВУЮ версию назначения. Существующие строки не трогает."""

    prescription = Prescription(
        patient_id=patient_id,
        ratio=ratio,
        kcal_per_day=kcal_per_day,
        protein_g=protein_g,
        carbs_limit_g=carbs_limit_g,
        meals_per_day=meals_per_day,
        fluid_ml_per_day=fluid_ml_per_day,
        restrictions=restrictions,
        author_id=author_id,
        effective_from=effective_from,
    )
    session.add(prescription)
    await session.flush()
    return prescription


def active_on(history: Iterable[Prescription], day: date) -> Prescription | None:
    """Назначение, действовавшее в день `day`, из уже прочитанной истории.

    То же правило, что `get_active_on`, для мест, где история читается целиком
    (сводка врача по дням периода). Последняя ЗАПИСАННАЯ из начавшихся, а не
    начавшаяся последней: версия, записанная задним числом, — это поправка
    врача, и она перекрывает прежнюю и в прошлых днях.
    """

    started = [item for item in history if item.effective_from <= day]
    return max(started, key=lambda item: item.created_at) if started else None


async def get_active_on(
    session: AsyncSession, *, patient_id: uuid.UUID, day: date
) -> Prescription | None:
    """Назначение, действовавшее в день `day` (правило — в шапке модуля).

    О прошедшем дне судят по его норме: врач, сменивший назначение сегодня,
    не делает вчерашний день недобором или перебором.
    """

    stmt = (
        select(Prescription)
        .where(Prescription.patient_id == patient_id, Prescription.effective_from <= day)
        .order_by(desc(Prescription.created_at))
        .limit(1)
    )
    result: Prescription | None = await session.scalar(stmt)
    return result


async def get_upcoming(
    session: AsyncSession, *, patient_id: uuid.UUID, today: date, active: Prescription | None
) -> Prescription | None:
    """Записанная, но ещё не начавшаяся версия — «с 20.11 новое назначение».

    Последняя записанная из тех, у кого дата начала позже `today`, и только если
    она записана позже действующей: более ранняя будущая версия уже перекрыта
    поправкой врача и не начнётся никогда.
    """

    stmt = (
        select(Prescription)
        .where(Prescription.patient_id == patient_id, Prescription.effective_from > today)
        .order_by(desc(Prescription.created_at))
        .limit(1)
    )
    upcoming: Prescription | None = await session.scalar(stmt)
    if upcoming is None or (active is not None and upcoming.created_at <= active.created_at):
        return None
    return upcoming


async def get_active(session: AsyncSession, *, patient_id: uuid.UUID) -> Prescription | None:
    """Действующее сегодня назначение (местные сутки установки)."""

    return await get_active_on(session, patient_id=patient_id, day=local_today())


async def list_history(
    session: AsyncSession, *, patient_id: uuid.UUID, limit: int = 50, offset: int = 0
) -> tuple[list[Prescription], int]:
    stmt = (
        select(Prescription)
        .where(Prescription.patient_id == patient_id)
        .order_by(desc(Prescription.created_at))
        .limit(limit)
        .offset(offset)
    )
    items = list(await session.scalars(stmt))

    total = await session.scalar(
        select(func.count()).select_from(Prescription).where(Prescription.patient_id == patient_id)
    )
    return items, int(total or 0)
