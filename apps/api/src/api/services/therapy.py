"""Проверки вокруг даты начала кетодиетотерапии (ответ клиники, вопрос 17).

По этой дате отсчитываются контрольные визиты и решается, считать ли ответ семьи
о частоте приступов исходным уровнем. Опечатка в ней тихо сдвигает и то и
другое: расписание визитов уедет на годы, а точка отсчёта либо запишется там,
где не должна, либо не запишется вовсе.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from core.repositories import patients as patients_repo

from ..errors import ApiError, ErrorCode

_FIELD = "therapy_started_on"


async def check_therapy_start_is_plausible(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    therapy_started_on: date | None,
) -> None:
    """Дата начала терапии не раньше рождения ребёнка.

    **Будущая дата разрешена** и проверкой не считается: врач назначает диету «с
    понедельника» и вносит дату заранее — запрет означал бы, что записать
    решение до его исполнения нельзя. Тем же занята и `started_on` в правиле про
    исходную частоту: она сравнивает дату с сегодняшним днём, а не запрещает её.

    А вот дата раньше рождения — заведомо опечатка (перепутанный год), и это не
    медицинское суждение, а тождество: до рождения ребёнка диеты не было.
    Порогов вида «не раньше чем через месяц после дебюта» здесь нет намеренно —
    любой такой порог был бы выдуманной медицинской константой (правило 1).
    """

    if therapy_started_on is None:
        return

    patient = await patients_repo.get(session, patient_id)
    if patient is None or patient.birth_date is None:
        return

    if therapy_started_on < patient.birth_date:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Дата начала диетотерапии раньше даты рождения ребёнка — проверьте год.",
            details={"field": _FIELD},
        )
