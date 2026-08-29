"""`/patients/{id}/intake` — анкета регистрации, часть, которую заполняет семья.

ADR-0007. Врачебная часть анкеты (число сменённых ПЭП) лежит в медицинском
профиле и правится своей ручкой: разделение по таблицам и есть разделение права
записи (правило 5 CLAUDE.md), и родитель не запишет врачебное поле, даже
отправив запрос напрямую.

Писать анкету может любой, у кого есть доступ к пациенту, — не только родитель.
Заполнять её могут и в клинике при первом визите; «объективность», о которой
просил заказчик, обеспечивается не тем, кто набирает текст, а тем, какие поля
семье недоступны.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path

from core.models.enums import IntakeScale
from core.repositories import intake as intake_repo

from ..deps.auth import PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas_intake import PatientIntakeRead, PatientIntakeWrite
from ..services import intake as intake_service

router = APIRouter(prefix="/patients/{patient_id}", tags=["intake"])

# Какая шкала стоит за каждым полем анкеты. Внешний ключ проверяет только
# существование варианта, но не его смысл: без этой сверки «Ежедневно» можно
# записать в длительность приступа, и анкета перестанет что-либо значить.
_FIELD_SCALES: dict[str, IntakeScale] = {
    "onset_age_id": IntakeScale.ONSET_AGE,
    "seizure_frequency_id": IntakeScale.SEIZURE_FREQUENCY,
    "seizure_duration_id": IntakeScale.SEIZURE_DURATION,
    "meals_per_day_id": IntakeScale.MEALS_PER_DAY,
}


@router.get(
    "/intake",
    response_model=PatientIntakeRead,
    summary="Анкета регистрации пациента",
)
async def get_intake(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> PatientIntakeRead:
    intake = await intake_repo.get_for_patient(session, patient_id=patient_id)
    if intake is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Анкета ещё не заполнена.")
    return PatientIntakeRead.model_validate(intake)


@router.put(
    "/intake",
    response_model=PatientIntakeRead,
    summary="Заполнить или изменить анкету регистрации",
)
async def put_intake(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: PatientIntakeWrite,
    session: SessionDep,
    _: PatientAccessDep,
) -> PatientIntakeRead:
    """Одна анкета на пациента (unique patient_id), поэтому PUT — upsert."""

    for field, scale in _FIELD_SCALES.items():
        await intake_service.check_option_scale(
            session, option_id=getattr(payload, field), scale=scale, field=field
        )
    await intake_service.check_known_drugs(session, payload.current_aed_ids)

    intake = await intake_repo.upsert(
        session,
        patient_id=patient_id,
        last_seizure_on=payload.last_seizure_on,
        onset_age_id=payload.onset_age_id,
        seizure_frequency_id=payload.seizure_frequency_id,
        seizure_duration_id=payload.seizure_duration_id,
        meals_per_day_id=payload.meals_per_day_id,
        developmental_delay=payload.developmental_delay,
        meals_regular=payload.meals_regular,
        current_aed_ids=payload.current_aed_ids,
    )
    return PatientIntakeRead.model_validate(intake)
