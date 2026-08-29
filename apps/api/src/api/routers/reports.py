"""`/reports` — отчёт по пациенту за период (раздел 5.3 ТЗ, раздел 15 п. 14).

Форматы: `json` — для экрана, `csv` — для выгрузки в чужие инструменты. PDF
собирает воркер задачей `render_report`; ручка появится вместе с ним.

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
from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query, Response

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import patients as patients_repo

from ..deps.auth import PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas_reports import PatientReport
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
    report_format: Annotated[Literal["json", "csv"], Query(alias="format")] = "json",
) -> PatientReport | Response:
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

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="export",
        entity="reports",
        entity_id=patient.id,
        before=None,
        # Содержимое отчёта в журнал не пишется — это клинические данные, а
        # журнал читает администратор, которому они недоступны (раздел 5.1 ТЗ).
        # Достаточно того, что именно и за какой период было выгружено.
        after={
            "format": "csv",
            "from": period_from.isoformat(),
            "to": period_to.isoformat(),
        },
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
