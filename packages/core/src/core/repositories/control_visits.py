"""Контрольные визиты (вопросы 17 и 34, ADR-0050).

Визиты хранятся, а не выводятся из даты начала терапии: отметить, что визит
состоялся, можно только у того, что существует. Удаление — мягкое (правило 4):
визит — часть клинической истории наблюдения.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..control_schedule import PlannedPoint
from ..models import ControlVisit, Patient, ReminderSettings, TelegramAccount
from . import therapy as therapy_repo


async def list_for_patient(session: AsyncSession, *, patient_id: uuid.UUID) -> list[ControlVisit]:
    """Живые визиты пациента по дате."""

    rows = await session.scalars(
        select(ControlVisit)
        .where(ControlVisit.patient_id == patient_id, ControlVisit.deleted_at.is_(None))
        .order_by(ControlVisit.planned_on, ControlVisit.created_at)
    )
    return list(rows)


async def get(
    session: AsyncSession, *, patient_id: uuid.UUID, visit_id: uuid.UUID
) -> ControlVisit | None:
    """Визит этого пациента. Чужой и удалённый не читаются — одинаково `None`."""

    visit: ControlVisit | None = await session.scalar(
        select(ControlVisit).where(
            ControlVisit.id == visit_id,
            ControlVisit.patient_id == patient_id,
            ControlVisit.deleted_at.is_(None),
        )
    )
    return visit


async def create(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    planned_on: date,
    note: str | None,
    created_by: uuid.UUID,
    month_offset: int | None = None,
) -> ControlVisit:
    visit = ControlVisit(
        patient_id=patient_id,
        planned_on=planned_on,
        note=note,
        created_by=created_by,
        month_offset=month_offset,
    )
    session.add(visit)
    await session.flush()
    await session.refresh(visit)
    return visit


async def add_schedule(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    points: Sequence[PlannedPoint],
    created_by: uuid.UUID,
) -> list[ControlVisit]:
    """Добавляет точки графика, которых у пациента ещё нет.

    Точка, уже заведённая по тому же месяцу (в том числе перенесённая врачом на
    другую дату или отмеченная состоявшейся), не пересоздаётся: повторное
    построение графика не должно затирать правки врача.
    """

    # Два одновременных «Построить график» иначе оба увидели бы пустоту и
    # второй упал бы на уникальном индексе: построение идёт по одному на ребёнка.
    await session.execute(select(Patient.id).where(Patient.id == patient_id).with_for_update())
    # Отменённая врачом точка (мягко удалённая) тоже считается заведённой:
    # повторное построение не должно возвращать визит, который врач отменил.
    # Вернуть его можно визитом вне графика.
    existing = set(
        await session.scalars(
            select(ControlVisit.month_offset).where(
                ControlVisit.patient_id == patient_id,
                ControlVisit.month_offset.is_not(None),
            )
        )
    )
    created: list[ControlVisit] = []
    for point in points:
        if point.month_offset in existing:
            continue
        created.append(
            await create(
                session,
                patient_id=patient_id,
                planned_on=point.planned_on,
                note=None,
                created_by=created_by,
                month_offset=point.month_offset,
            )
        )
    return created


async def update(
    session: AsyncSession, *, visit: ControlVisit, fields: dict[str, Any]
) -> ControlVisit:
    for name, value in fields.items():
        setattr(visit, name, value)
    await session.flush()
    await session.refresh(visit)
    return visit


async def soft_delete(session: AsyncSession, *, visit: ControlVisit) -> None:
    visit.deleted_at = datetime.now(UTC)
    await session.flush()


async def next_open_map(
    session: AsyncSession, *, patient_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, ControlVisit]:
    """Ближайший несостоявшийся визит каждого пациента — одним запросом.

    «Ближайший» — самый ранний из неотмеченных, в том числе уже прошедший:
    пропущенный визит важнее следующего, и прятать его за будущим нельзя.
    """

    if not patient_ids:
        return {}
    rows = await session.scalars(
        select(ControlVisit)
        .where(
            ControlVisit.patient_id.in_(list(patient_ids)),
            ControlVisit.deleted_at.is_(None),
            ControlVisit.completed_on.is_(None),
        )
        .order_by(ControlVisit.patient_id, ControlVisit.planned_on, ControlVisit.created_at)
        .distinct(ControlVisit.patient_id)
    )
    return {visit.patient_id: visit for visit in rows}


async def due_for_family_notice(
    session: AsyncSession, *, planned_on: date
) -> list[tuple[ControlVisit, TelegramAccount]]:
    """Визиты на дату `planned_on` и живые чаты семьи — для напоминания перед визитом.

    Ребёнок, завершивший терапию, напоминаний не получает (вопрос 18): визит,
    оставшийся в его графике, больше не план.

    Выключатель «Присылать напоминания» действует и здесь. Прежде визит
    напоминал о себе мимо него, и семья, выключившая напоминания, всё равно
    получала сообщение от бота — при том что экран обещал тишину. Строки
    настроек может не быть вовсе (семья их не открывала): тогда действует
    умолчание — включено, как у `reminders.list_active`.
    """

    rows = await session.execute(
        select(ControlVisit, TelegramAccount)
        .join(TelegramAccount, TelegramAccount.patient_id == ControlVisit.patient_id)
        .outerjoin(ReminderSettings, ReminderSettings.patient_id == ControlVisit.patient_id)
        .where(
            func.coalesce(ReminderSettings.enabled, True).is_(True),
            ControlVisit.planned_on == planned_on,
            ControlVisit.deleted_at.is_(None),
            ControlVisit.completed_on.is_(None),
            TelegramAccount.revoked_at.is_(None),
            ~therapy_repo.therapy_ended(ControlVisit.patient_id),
        )
        .order_by(ControlVisit.patient_id)
    )
    return [(visit, link) for visit, link in rows]
