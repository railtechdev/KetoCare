"""Кому напоминать (раздел 7.4 ТЗ; аудит блокеров, 05.10.2026).

Две находки аудита, которые держат эти тесты:
- семья, ни разу не открывавшая настройки (каждая семья из Telegram — у неё нет
  кабинета), не получала даже напоминания «из коробки»: выборка шла от
  сохранённых настроек;
- при двух взрослых с Telegram напоминание получал один: право на отправку
  занималось на ребёнка, а не на чат.
"""

from __future__ import annotations

import random
import uuid
from datetime import date, time

import pytest

from core.models.enums import Sex, UserRole
from core.repositories import patients, reminders, telegram, users

pytestmark = pytest.mark.asyncio


async def _family_with_chats(session, chats: int):
    patient = await patients.create(
        session, full_name="Тестовый Ребёнок", birth_date=date(2018, 5, 1), sex=Sex.M
    )
    links = []
    for _ in range(chats):
        parent = await users.create(
            session,
            role=UserRole.PARENT,
            full_name="Тест родитель",
            email=f"parent-{uuid.uuid4().hex[:8]}@example.com",
            password_hash="argon2-placeholder",
        )
        await patients.link_parent(session, parent_id=parent.id, patient_id=patient.id)
        links.append(
            await telegram.create_link(
                session,
                parent_id=parent.id,
                patient_id=patient.id,
                chat_id=random.randint(10**9, 2 * 10**9),
                secret=telegram.generate_binding_secret(),
            )
        )
    return patient, links


async def test_family_without_saved_settings_gets_the_default(session):
    patient, [link] = await _family_with_chats(session, 1)

    active = [
        (settings, chat)
        for settings, chat in await reminders.list_active(session)
        if chat.patient_id == patient.id
    ]

    assert len(active) == 1
    settings, chat = active[0]
    assert chat.id == link.id
    assert settings.no_records_at == time(hour=reminders.DEFAULT_NO_RECORDS_HOUR)
    assert settings.ketones_at is None


async def test_switched_off_family_gets_nothing(session):
    patient, _ = await _family_with_chats(session, 1)
    await reminders.upsert(
        session,
        patient_id=patient.id,
        updated_by=None,
        enabled=False,
        ketones_at=None,
        weight_at=None,
        medications_at=None,
        no_records_at=None,
    )

    active = [
        chat for _, chat in await reminders.list_active(session) if chat.patient_id == patient.id
    ]

    assert active == []


async def test_every_adult_with_telegram_is_reminded(session):
    patient, links = await _family_with_chats(session, 2)
    today = date(2026, 10, 5)

    claimed = [
        await reminders.claim_delivery(
            session, patient_id=patient.id, kind="no_records", sent_on=today, chat_id=link.chat_id
        )
        for link in links
    ]
    again = await reminders.claim_delivery(
        session, patient_id=patient.id, kind="no_records", sent_on=today, chat_id=links[0].chat_id
    )

    assert claimed == [True, True]
    assert again is False, "одному чату — один раз в день"
