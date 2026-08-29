"""Выборки дневников для сводки главного экрана (раздел 5.3 ТЗ: `GET /patients/{id}/overview`).

Отдельный модуль, а не дополнение к `diary`: сводке нужны запросы другой формы —
одна последняя запись и счётчик за интервал, без общего количества строк. Раздел
8.3 ТЗ требует, чтобы главная грузилась одним запросом, поэтому лишние `COUNT`
списочных выборок здесь ни к чему.

Меню и назначение сводка берёт готовыми репозиториями `menus` и `prescriptions`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import SeizureLog
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


async def count_seizures(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_from: datetime,
    period_to: datetime,
) -> SeizureTotals:
    """Приступы за полуоткрытый интервал [period_from, period_to).

    Полуоткрытый — чтобы запись ровно в полночь принадлежала одному дню, а не
    попадала в счётчики обоих соседних.
    """

    stmt = select(
        func.count(SeizureLog.id),
        func.coalesce(func.sum(SeizureLog.count), 0),
    ).where(
        SeizureLog.patient_id == patient_id,
        SeizureLog.deleted_at.is_(None),
        SeizureLog.occurred_at >= period_from,
        SeizureLog.occurred_at < period_to,
    )
    entries, seizures = (await session.execute(stmt)).one()
    return SeizureTotals(entries=int(entries), count=int(seizures))
