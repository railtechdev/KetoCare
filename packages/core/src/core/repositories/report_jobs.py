"""Задачи сборки PDF-отчёта (раздел 5.3 ТЗ, ADR-0008).

Состояние задачи живёт в БД, а не только в очереди: по идентификатору нужно
проверить право скачивать файл (это клинические данные), а Redis эфемерен.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ReportJob
from ..models.enums import ReportJobStatus


async def get(session: AsyncSession, job_id: uuid.UUID) -> ReportJob | None:
    job: ReportJob | None = await session.get(ReportJob, job_id)
    return job


async def create(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    requested_by: uuid.UUID,
    period_start: date,
    period_end: date,
) -> ReportJob:
    job = ReportJob(
        patient_id=patient_id,
        requested_by=requested_by,
        period_start=period_start,
        period_end=period_end,
        status=ReportJobStatus.QUEUED,
    )
    session.add(job)
    await session.flush()
    return job


async def mark_running(session: AsyncSession, *, job: ReportJob) -> ReportJob:
    job.status = ReportJobStatus.RUNNING
    await session.flush()
    return job


async def mark_done(
    session: AsyncSession, *, job: ReportJob, file_name: str, expires_at: datetime
) -> ReportJob:
    job.status = ReportJobStatus.DONE
    job.file_name = file_name
    job.expires_at = expires_at
    job.finished_at = datetime.now(UTC)
    job.error = None
    await session.flush()
    return job


async def mark_failed(session: AsyncSession, *, job: ReportJob, error: str) -> ReportJob:
    job.status = ReportJobStatus.FAILED
    # Текст ошибки обрезается: сюда попадает исключение рендера, и трассировка
    # в поле, которое покажут пользователю, ни к чему.
    job.error = error[:500]
    job.finished_at = datetime.now(UTC)
    await session.flush()
    return job


async def list_expired(session: AsyncSession, *, now: datetime) -> list[ReportJob]:
    """Задачи, у которых истёк срок ссылки, — для уборки файлов.

    Строки остаются: по журналу должно быть видно, что отчёт заказывали, даже
    когда файла уже нет.
    """

    return list(
        await session.scalars(
            select(ReportJob).where(
                ReportJob.status == ReportJobStatus.DONE,
                ReportJob.expires_at.is_not(None),
                ReportJob.expires_at < now,
                ReportJob.file_name.is_not(None),
            )
        )
    )


async def mark_file_removed(session: AsyncSession, *, job: ReportJob) -> None:
    """Файл отчёта убран с диска; строка остаётся.

    Обнуление `file_name` — это и отметка об уборке: без неё `list_expired`
    возвращала бы одни и те же задачи каждую ночь до конца времён.
    """

    job.file_name = None
    await session.flush()
