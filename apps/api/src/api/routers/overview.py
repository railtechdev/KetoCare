"""`/patients/{patient_id}/overview` — сводка для главной (раздел 5.3 ТЗ).

Раздел 8.3 ТЗ требует, чтобы главная родителя грузилась одним запросом, поэтому
ручка отдаёт весь экран сразу: назначение, итоги дня против него, последние
кетоны и вес, приступы за сегодня. Сборка — в `services.overview`.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path

from core.models.enums import UserRole

from ..deps.auth import PatientAccessDep, SessionDep
from ..schemas_overview import PatientOverview
from ..services import overview as overview_service

router = APIRouter(prefix="/patients/{patient_id}/overview", tags=["overview"])


@router.get("", response_model=PatientOverview, summary="Сводка для главной")
async def get_overview(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    user: PatientAccessDep,
) -> PatientOverview:
    overview = await overview_service.build_overview(session, patient_id=patient_id)
    if user.role is UserRole.PARENT and overview.next_control is not None:
        # Цель визита («оценка эффективности», «решение о продолжении») семье не
        # отдаётся: о ней говорит врач, а не продукт (ADR-0050). Дата визита —
        # отдаётся: о ней семье и так пишет бот.
        overview = overview.model_copy(
            update={"next_control": overview.next_control.model_copy(update={"purpose": None})}
        )
    return overview
