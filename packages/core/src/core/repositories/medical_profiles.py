"""Репозиторий медицинского профиля пациента (раздел 4.2 ТЗ).

Профиль один на пациента (`unique(patient_id)`), поэтому запись выполняется
upsert'ом: отдельной ручки создания нет, PUT либо создаёт строку, либо
перезаписывает существующую.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MedicalProfile
from ..models.enums import TherapyEndReason


async def get_for_patient(session: AsyncSession, *, patient_id: uuid.UUID) -> MedicalProfile | None:
    """Профиль пациента, если он есть и не удалён мягко (раздел 4.1 ТЗ)."""

    profile: MedicalProfile | None = await session.scalar(
        select(MedicalProfile).where(
            MedicalProfile.patient_id == patient_id,
            MedicalProfile.deleted_at.is_(None),
        )
    )
    return profile


async def upsert(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    diagnosis: str | None,
    epilepsy_type: str | None,
    onset_age_months: int | None,
    genetics: dict[str, Any] | None,
    comorbidities: str | None,
    aed_switch_count_id: uuid.UUID | None = None,
    therapy_started_on: date | None = None,
) -> MedicalProfile:
    """Создаёт профиль или полностью перезаписывает существующий."""

    # Здесь, в отличие от get_for_patient, строка ищется БЕЗ фильтра по deleted_at:
    # уникальный индекс по patient_id распространяется и на мягко удалённые строки,
    # поэтому вставка поверх удалённого профиля упала бы на ограничении БД (500
    # вместо сохранённого профиля). Мягко удалённый профиль возвращается к жизни.
    profile: MedicalProfile | None = await session.scalar(
        select(MedicalProfile).where(MedicalProfile.patient_id == patient_id)
    )

    if profile is None:
        profile = MedicalProfile(patient_id=patient_id)
        session.add(profile)

    profile.diagnosis = diagnosis
    profile.epilepsy_type = epilepsy_type
    profile.onset_age_months = onset_age_months
    profile.genetics = genetics
    profile.comorbidities = comorbidities
    # Сколько ПЭП сменил ребёнок — врачебная часть анкеты регистрации
    # (ADR-0007): семья путает и названия, и число попыток, а от этого числа
    # зависит, считается ли эпилепсия фармакорезистентной.
    profile.aed_switch_count_id = aed_switch_count_id
    # Дата начала кетодиетотерапии — ответ клиники 09.09.2026 (вопрос 17). По
    # ней решается, считать ли ответ семьи о частоте приступов исходным уровнем,
    # и идёт ли первый месяц строгого наблюдения (вопрос 11). Читать её надо
    # через `repositories.therapy`, а не отсюда: там же лежит запасной вывод из
    # первого назначения.
    profile.therapy_started_on = therapy_started_on
    profile.deleted_at = None
    # Завершение терапии (`therapy_ended_on` и причина) здесь НЕ пишется: у него
    # своя ручка с отдельной записью в журнал (ADR-0050). Правка диагноза не
    # должна молча снимать или ставить завершение.

    await session.flush()

    # UPDATE помечает `updated_at` (onupdate=now()) устаревшим, и его значение
    # подгружается ленивым запросом при первом обращении. В асинхронной сессии
    # ленивая подгрузка вне await'а падает (MissingGreenlet), а обращается к полю
    # уже сериализатор ответа — поэтому значение дочитывается здесь явно.
    await session.refresh(profile)
    return profile


async def set_therapy_end(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    ended_on: date | None,
    reason: TherapyEndReason | None,
    note: str | None,
) -> MedicalProfile:
    """Ставит (или снимает при `ended_on=None`) завершение терапии (вопрос 18).

    Профиля может ещё не быть: врач вправе завершить терапию ребёнку, которому
    диагноз не заполняли. Тогда заводится пустой профиль — как у `upsert`,
    вместе с возвратом мягко удалённой строки.
    """

    profile: MedicalProfile | None = await session.scalar(
        select(MedicalProfile).where(MedicalProfile.patient_id == patient_id)
    )
    if profile is None:
        profile = MedicalProfile(patient_id=patient_id)
        session.add(profile)
    profile.deleted_at = None
    profile.therapy_ended_on = ended_on
    profile.therapy_end_reason = reason
    profile.therapy_end_note = note
    await session.flush()
    await session.refresh(profile)
    return profile
