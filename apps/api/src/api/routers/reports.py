"""`/reports` — отчёт по пациенту за период (раздел 5.3 ТЗ, раздел 15 п. 14).

Форматы: `json` — для экрана, `csv` — для выгрузки в чужие инструменты, `pdf` —
задачей воркера `render_report` с поллингом `GET /reports/jobs/{id}` и
скачиванием `GET /reports/jobs/{id}/file` (раздел 7.5 ТЗ, ADR-0008).

Доступ — `require_patient_access`, как у любых данных пациента. CSV дополнительно
ограничен ролью: раздел 8.3 ТЗ помечает выгрузку «только doctor», и это не про
удобство — файл уезжает из продукта, и дальше его судьбу никто не контролирует.

**Выгрузка пишется в `audit_log`.** Правило 7 CLAUDE.md перечисляет выгрузки
данных наравне с назначениями: когда клинические данные покидают систему, должен
остаться след, кто и что забрал.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from pathlib import Path as FilePath
from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query, Response
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from core.config import Settings
from core.models import ReportJob
from core.models.enums import ReportJobStatus, UserRole
from core.repositories import access as access_repo
from core.repositories import audit as audit_repo
from core.repositories import patients as patients_repo
from core.repositories import report_jobs as jobs_repo

from ..deps.auth import CurrentUserDep, PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas_reports import PatientReport, ReportJobRead
from ..services import queue as queue_service
from ..services import reports as reports_service

router = APIRouter(prefix="/patients/{patient_id}", tags=["reports"])

# Предел периода — защита от выгрузки «за всё время» одним запросом: отчёт
# собирается синхронно, и год дневника в одном ответе положит и ручку, и экран.
MAX_PERIOD_DAYS = 400


@router.get(
    "/report",
    summary="Отчёт по пациенту за период",
    response_model=None,
)
async def get_report(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    user: PatientAccessDep,
    period_from: Annotated[date, Query(alias="from")],
    period_to: Annotated[date, Query(alias="to")],
    report_format: Annotated[Literal["json", "csv", "pdf"], Query(alias="format")] = "json",
) -> PatientReport | ReportJobRead | Response:
    if period_to < period_from:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Конец периода раньше его начала.",
            details={"field": "to"},
        )
    if (period_to - period_from).days + 1 > MAX_PERIOD_DAYS:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Период длиннее {MAX_PERIOD_DAYS} дней; выберите отрезок покороче.",
            details={"field": "to"},
        )

    if report_format == "csv" and user.role is not UserRole.DOCTOR:
        # Тот же код, что и у чужого пациента: по ответу нельзя отличить
        # «не твой пациент» от «не твоя роль».
        raise ApiError(ErrorCode.FORBIDDEN, "Выгрузка доступна врачу.")

    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пациент не найден.")

    report = await reports_service.build_report(
        session,
        patient=patient,
        period_from=period_from,
        period_to=period_to,
        generated_at=datetime.now(UTC),
    )

    if report_format == "json":
        return report

    if report_format == "pdf":
        # PDF собирает воркер: weasyprint долгий, и держать на нём веб-процесс
        # нельзя (раздел 10.1 ТЗ). Ручка возвращает идентификатор задачи.
        job = await jobs_repo.create(
            session,
            patient_id=patient.id,
            requested_by=user.id,
            period_start=period_from,
            period_end=period_to,
        )
        await _audit_export(
            session,
            user_id=user.id,
            patient_id=patient.id,
            report_format="pdf",
            period_from=period_from,
            period_to=period_to,
        )
        # Данные отчёта уезжают в задачу готовыми: воркер не собирает их заново,
        # иначе отчёт на экране и отчёт в PDF однажды разойдутся (ADR-0008).
        await queue_service.enqueue("render_report", str(job.id), report.model_dump(mode="json"))
        return ReportJobRead.model_validate(job)

    await _audit_export(
        session,
        user_id=user.id,
        patient_id=patient.id,
        report_format="csv",
        period_from=period_from,
        period_to=period_to,
    )

    filename = f"ketocare-report-{patient.id}-{period_from}-{period_to}.csv"
    return Response(
        # BOM: без него Excel открывает кириллицу как мусор, а отчёт носят
        # именно в Excel.
        content="﻿" + reports_service.report_to_csv(report),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


async def _audit_export(
    session: SessionDep,
    *,
    user_id: uuid.UUID,
    patient_id: uuid.UUID,
    report_format: str,
    period_from: date,
    period_to: date,
) -> None:
    """След выгрузки в журнале (правило 7 CLAUDE.md).

    Содержимое отчёта в журнал не пишется — это клинические данные, а журнал
    читает администратор, которому они недоступны (раздел 5.1 ТЗ). Достаточно
    того, что именно и за какой период было выгружено.
    """

    await audit_repo.write_audit_log(
        session,
        user_id=user_id,
        action="export",
        entity="reports",
        entity_id=patient_id,
        before=None,
        after={
            "format": report_format,
            "from": period_from.isoformat(),
            "to": period_to.isoformat(),
        },
    )


jobs_router = APIRouter(prefix="/reports/jobs", tags=["reports"])


async def _job_with_access(
    session: SessionDep, user: CurrentUserDep, job_id: uuid.UUID
) -> ReportJob:
    """Задача и проверка права на неё.

    `require_patient_access` здесь не подходит: он берёт `patient_id` из пути, а
    в пути только идентификатор задачи. Поэтому пациент читается из задачи, и
    доступ проверяется тем же репозиторием, что и в зависимости, — обходить
    правило 5 нельзя даже ради удобной сигнатуры.
    """

    job = await jobs_repo.get(session, job_id)
    if job is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Задача отчёта не найдена.")

    allowed = await access_repo.user_has_patient_access(
        session, user_id=user.id, role=user.role, patient_id=job.patient_id
    )
    if not allowed:
        raise ApiError(ErrorCode.FORBIDDEN, "Нет доступа к этому пациенту.")
    return job


@jobs_router.get(
    "/{job_id}",
    response_model=ReportJobRead,
    summary="Состояние сборки PDF-отчёта",
)
async def get_report_job(
    job_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    user: CurrentUserDep,
) -> ReportJobRead:
    return ReportJobRead.model_validate(await _job_with_access(session, user, job_id))


@jobs_router.get(
    "/{job_id}/file",
    summary="Скачать собранный PDF-отчёт",
    response_model=None,
)
async def download_report(
    job_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    user: CurrentUserDep,
) -> Response:
    job = await _job_with_access(session, user, job_id)

    if job.status is not ReportJobStatus.DONE or job.file_name is None:
        raise ApiError(ErrorCode.CONFLICT, "Отчёт ещё не собран.")

    now = datetime.now(UTC)
    if job.expires_at is not None and job.expires_at < now:
        # Ссылка с истечением (раздел 7.5 ТЗ): просроченную не продлеваем молча,
        # а просим собрать заново — файла к этому моменту может уже не быть.
        raise ApiError(ErrorCode.NOT_FOUND, "Срок ссылки на отчёт истёк, соберите заново.")

    file_path = await run_in_threadpool(_resolve_report_file, job.file_name)
    if file_path is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Файл отчёта недоступен.")

    # FileResponse отдаёт файл потоком: читать несколько мегабайт в память
    # веб-процесса ради одного скачивания незачем.
    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=job.file_name,
        headers={"X-Content-Type-Options": "nosniff"},
    )


def _resolve_report_file(file_name: str) -> FilePath | None:
    """Путь к файлу внутри тома отчётов, если он там есть.

    Синхронная: обращения к файловой системе блокируют цикл событий, и вызывать
    её нужно через пул потоков. Имя проверяется на выход за пределы каталога —
    оно приходит из базы, но правило «имя не участвует в пути как есть» дешевле
    соблюсти, чем однажды обнаружить обратное (то же решение в ADR-0004).
    """

    settings = Settings()  # type: ignore[call-arg]
    base = FilePath(settings.reports_dir).resolve()
    target = (base / file_name).resolve()
    if not target.is_relative_to(base) or not target.exists():
        return None
    return target
