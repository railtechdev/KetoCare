"""Сводки за период: черновик модели и подтверждённый врачом текст (раздел 10.5 ТЗ).

Выборка «только подтверждённые» живёт не здесь, а в `repositories/reports.py`
(`list_approved_summaries`): фильтр `approved_md is not null` должен остаться в
одном месте, иначе второй его вариант однажды окажется без фильтра.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import DoctorSummary
from ..models.enums import AiJobStatus

#: Состояния, в которых заказ ещё не завершён. Пока такой есть, повторный заказ
#: за тот же период отдаёт его же: каждая сборка — платный вызов модели.
PENDING = (AiJobStatus.QUEUED, AiJobStatus.RUNNING)


async def create(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    requested_by: uuid.UUID,
    period_start: date,
    period_end: date,
) -> DoctorSummary:
    """Завести заказ сводки. Текста ещё нет — он появится, когда ответит модель."""

    summary = DoctorSummary(
        patient_id=patient_id,
        requested_by=requested_by,
        period_start=period_start,
        period_end=period_end,
        status=AiJobStatus.QUEUED,
    )
    session.add(summary)
    await session.flush()
    return summary


async def get(session: AsyncSession, summary_id: uuid.UUID) -> DoctorSummary | None:
    return await session.get(DoctorSummary, summary_id)


async def list_for_period(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_start: date,
    period_end: date,
) -> list[DoctorSummary]:
    """Сводки, заказанные ровно за этот период, новые сверху.

    Именно ровно: сводка за август и сводка за сентябрь — разные документы, и
    показывать врачу первую, когда он смотрит на второй период, значит
    предлагать утвердить текст про чужие числа.
    """

    return list(
        await session.scalars(
            select(DoctorSummary)
            .where(
                DoctorSummary.patient_id == patient_id,
                DoctorSummary.period_start == period_start,
                DoctorSummary.period_end == period_end,
            )
            .order_by(DoctorSummary.created_at.desc())
        )
    )


async def find_pending(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    period_start: date,
    period_end: date,
) -> DoctorSummary | None:
    """Незавершённый заказ за тот же период, если он есть."""

    found: DoctorSummary | None = await session.scalar(
        select(DoctorSummary)
        .where(
            DoctorSummary.patient_id == patient_id,
            DoctorSummary.period_start == period_start,
            DoctorSummary.period_end == period_end,
            DoctorSummary.status.in_(PENDING),
        )
        .order_by(DoctorSummary.created_at.desc())
        .limit(1)
    )
    return found


async def mark_running(session: AsyncSession, summary_id: uuid.UUID) -> None:
    summary = await session.get(DoctorSummary, summary_id)
    if summary is not None:
        summary.status = AiJobStatus.RUNNING


async def attach_draft(
    session: AsyncSession,
    summary_id: uuid.UUID,
    *,
    draft_md: str,
    checks: list[dict[str, Any]],
    ai_job_id: uuid.UUID | None,
) -> DoctorSummary | None:
    """Записать черновик вместе с находками постфильтра.

    Черновик сохраняется всегда, даже когда постфильтр что-то нашёл: за вызов
    уже заплачено, а врач должен отличать «модель написала лишнее» от «система
    сломалась». Клиническими данными текст не станет — в отчёт попадает только
    `approved_md` (правило 6 CLAUDE.md).
    """

    summary = await session.get(DoctorSummary, summary_id)
    if summary is None:
        return None
    summary.draft_md = draft_md
    summary.checks = checks
    summary.ai_job_id = ai_job_id
    summary.status = AiJobStatus.DONE
    return summary


async def mark_failed(
    session: AsyncSession, summary_id: uuid.UUID, *, error: str
) -> DoctorSummary | None:
    summary = await session.get(DoctorSummary, summary_id)
    if summary is None:
        return None
    summary.status = AiJobStatus.FAILED
    summary.error = error
    return summary


async def approve(
    session: AsyncSession,
    summary_id: uuid.UUID,
    *,
    approved_md: str,
    approved_by: uuid.UUID,
    approved_at: datetime,
) -> DoctorSummary | None:
    """Утвердить текст: с этого момента он попадает в отчёт, PDF и выгрузку."""

    summary = await session.get(DoctorSummary, summary_id)
    if summary is None:
        return None
    summary.approved_md = approved_md
    summary.approved_by = approved_by
    summary.approved_at = approved_at
    return summary
