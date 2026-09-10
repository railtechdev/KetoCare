"""Когда у ребёнка началась кетодиетотерапия — один ответ на весь продукт.

От этой даты отсчитываются контрольные визиты (ответ клиники 09.09.2026,
вопрос 17) и по ней решается, считать ли ответ семьи о частоте приступов
исходным уровнем (вопрос 19). Два разных ответа на один вопрос означали бы, что
врач видит одну дату старта в карте и другую — в правиле, которое молча решает
судьбу точки отсчёта.

Отдельным модулем, а не функцией в `prescriptions`: ответ собирается из ДВУХ
таблиц, и в репозитории назначений ему не место — он читал бы медицинский
профиль.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MedicalProfile
from . import prescriptions as prescriptions_repo


async def started_on(session: AsyncSession, *, patient_id: uuid.UUID) -> date | None:
    """Дата начала терапии: слово врача, иначе вывод из назначений.

    `None` — судить не по чему: врач дату не назвал и назначений нет вовсе.

    **Порядок именно такой.** Врач называет дату прямо
    (`medical_profiles.therapy_started_on`), и это единственный источник, который
    знает правду в двух обычных случаях: ребёнка перевели из другой клиники и
    завели в системе уже на диете (первое НАШЕ назначение позже настоящего
    старта), либо назначение записали заранее, а диету начали не в тот день.

    Вывод из самого раннего назначения остаётся запасным: поле новое, у ранее
    заведённых детей оно пусто, и без вывода правило про исходную частоту
    перестало бы работать у всех сразу.
    """

    named = await session.scalar(
        select(MedicalProfile.therapy_started_on).where(
            MedicalProfile.patient_id == patient_id,
            MedicalProfile.deleted_at.is_(None),
        )
    )
    if named is not None:
        return named

    return await prescriptions_repo.started_on(session, patient_id=patient_id)
