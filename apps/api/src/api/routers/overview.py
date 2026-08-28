"""`/patients/{patient_id}/overview` — сводка для главной (раздел 5.3 ТЗ).

Раздел 8.3 ТЗ требует, чтобы главная родителя грузилась одним запросом, поэтому
ручка отдаёт весь экран сразу: назначение, итоги дня против него, последние
кетоны и вес, приступы за сегодня. Сборка — в `services.overview`.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path

from ..deps.auth import PatientAccessDep, SessionDep
from ..schemas_overview import PatientOverview
from ..services import overview as overview_service

router = APIRouter(prefix="/patients/{patient_id}/overview", tags=["overview"])


@router.get("", response_model=PatientOverview, summary="Сводка для главной")
async def get_overview(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> PatientOverview:
    return await overview_service.build_overview(session, patient_id=patient_id)
