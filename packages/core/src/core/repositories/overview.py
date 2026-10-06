"""Выборки дневников для сводки главного экрана (раздел 5.3 ТЗ: `GET /patients/{id}/overview`).

Отдельный модуль, а не дополнение к `diary`: сводке нужны запросы другой формы —
одна последняя запись и счётчик за интервал, без общего количества строк. Раздел
8.3 ТЗ требует, чтобы главная грузилась одним запросом, поэтому лишние `COUNT`
списочных выборок здесь ни к чему.

Меню и назначение сводка берёт готовыми репозиториями `menus` и `prescriptions`.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from ..models import IntakeOption, MealLog, SeizureLog
from ..models.enums import IntakeScale
from .diary import DiaryLog


@dataclass(frozen=True, slots=True)
class SeizureTotals:
    """Приступы за интервал: число записей дневника и сумма их `count`.

    Возвращаются оба числа: в одной записи семья отмечает серию приступов
    (`seizure_logs.count`), поэтому «сколько было приступов» и «сколько раз
    записывали» — разные величины, и подменять одно другим нельзя.
    """

    entries: int
    count: int


async def latest_log[M: DiaryLog](
    session: AsyncSession, model: type[M], *, patient_id: uuid.UUID
) -> M | None:
    """Последняя по времени события запись дневника; мягко удалённые исключены."""

    stmt = (
        select(model)
        .where(model.patient_id == patient_id, model.deleted_at.is_(None))
        # id как вторичный ключ сортировки: у двух измерений с одинаковым
        # occurred_at порядок иначе недетерминирован, и главная показывала бы
        # то одно значение кетонов, то другое.
        .order_by(model.occurred_at.desc(), model.id.desc())
        .limit(1)
    )
    log: M | None = await session.scalar(stmt)
    return log


async def count_seizures_by_window(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    windows: Sequence[tuple[datetime, datetime]],
) -> list[SeizureTotals]:
    """Приступы за несколько интервалов — ОДНИМ запросом, в порядке `windows`.

    Сводка спрашивает про три окна одного пациента: сегодня, последняя неделя и
    предыдущая. Тремя запросами это три прохода по одному и тому же индексу
    `(patient_id, occurred_at)` — а главная врача собирает сводку на КАЖДОГО
    пациента списка (1 + N), поэтому цена умножается на размер когорты.

    Окна независимы и могут пересекаться: «сегодня» целиком лежит внутри
    последней недели, и запись, попавшая в оба, считается в обоих. Каждый
    интервал полуоткрытый, [from, to) — запись ровно в полночь принадлежит
    одному дню, а не обоим соседним.
    """

    if not windows:
        return []

    columns: list[ColumnElement[int]] = []
    for period_from, period_to in windows:
        inside = and_(
            SeizureLog.occurred_at >= period_from,
            SeizureLog.occurred_at < period_to,
        )
        columns.append(func.count(SeizureLog.id).filter(inside))
        columns.append(func.coalesce(func.sum(SeizureLog.count).filter(inside), 0))

    stmt = select(*columns).where(
        SeizureLog.patient_id == patient_id,
        SeizureLog.deleted_at.is_(None),
        # Общая рамка по всем окнам. Без неё агрегаты с `FILTER` заставили бы
        # читать дневник пациента целиком: отбор внутри `FILTER` планировщик
        # индексом не пользуется.
        SeizureLog.occurred_at >= min(period_from for period_from, _ in windows),
        SeizureLog.occurred_at < max(period_to for _, period_to in windows),
    )
    row = (await session.execute(stmt)).one()
    return [
        SeizureTotals(entries=int(row[index * 2]), count=int(row[index * 2 + 1]))
        for index in range(len(windows))
    ]


async def latest_prolonged_seizure(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    since: datetime,
    until: datetime,
    min_duration_sec: int,
    option_codes: Sequence[str],
) -> datetime | None:
    """Время последнего затяжного приступа в окне [since, until) — или None.

    Затяжной — либо измеренная длительность не меньше `min_duration_sec`, либо
    интервал со слов из шкалы, чья нижняя граница не ниже порога
    (`option_codes`). Обе ветви нужны: семья, не засекавшая секундомером,
    отмечает интервал, и пропустить его значило бы промолчать как раз там, где
    приступ длился дольше всего.
    """

    prolonged = or_(
        SeizureLog.duration_sec >= min_duration_sec,
        SeizureLog.duration_option_id.in_(
            select(IntakeOption.id).where(
                IntakeOption.scale == IntakeScale.SEIZURE_DURATION,
                IntakeOption.code.in_(list(option_codes)),
            )
        ),
    )
    stmt = select(func.max(SeizureLog.occurred_at)).where(
        SeizureLog.patient_id == patient_id,
        SeizureLog.deleted_at.is_(None),
        SeizureLog.occurred_at >= since,
        SeizureLog.occurred_at < until,
        prolonged,
    )
    latest: datetime | None = await session.scalar(stmt)
    return latest


async def has_meals_outside_plan(
    session: AsyncSession, *, patient_id: uuid.UUID, since: datetime, until: datetime
) -> bool:
    """Записана ли за период еда не по плану дня (без `menu_item_id`).

    Такая еда — свободным текстом в боте или в дневнике — в итоги плана не
    входит, и судить по одним отметкам «съедено», сколько ребёнок съел, нельзя.
    """

    found = await session.scalar(
        select(MealLog.id)
        .where(
            MealLog.patient_id == patient_id,
            MealLog.deleted_at.is_(None),
            MealLog.menu_item_id.is_(None),
            MealLog.occurred_at >= since,
            MealLog.occurred_at < until,
        )
        .limit(1)
    )
    return found is not None
