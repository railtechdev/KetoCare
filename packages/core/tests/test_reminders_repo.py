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
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

import pytest

from core.models import KetoneLog, MenuItem, WeightLog
from core.models.enums import DiarySource, KetoneMethod, Sex, UserRole
from core.repositories import (
    control_visits,
    diary,
    menus,
    patients,
    reminders,
    telegram,
    users,
)

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


async def _visit_planned(session, patient, link) -> date:
    planned_on = date(2026, 11, 20)
    await control_visits.create(
        session,
        patient_id=patient.id,
        planned_on=planned_on,
        note=None,
        created_by=link.parent_id,
    )
    return planned_on


def _visit_chats(rows) -> set[int]:
    return {link.chat_id for _visit, link in rows}


async def test_visit_notice_reaches_a_family_with_default_settings(session):
    """Строки настроек нет — действует умолчание «включено», как у list_active."""

    patient, [link] = await _family_with_chats(session, 1)
    planned_on = await _visit_planned(session, patient, link)

    rows = await control_visits.due_for_family_notice(session, planned_on=planned_on)

    assert link.chat_id in _visit_chats(rows)


async def test_visit_notice_honours_the_switch(session):
    """«Присылать напоминания» выключено — о визите бот тоже молчит.

    Прежде визит напоминал о себе мимо выключателя: экран обещал тишину, а
    сообщение приходило.
    """

    patient, [link] = await _family_with_chats(session, 1)
    planned_on = await _visit_planned(session, patient, link)
    await reminders.upsert(session, patient_id=patient.id, updated_by=None, enabled=False)

    rows = await control_visits.due_for_family_notice(session, planned_on=planned_on)

    assert link.chat_id not in _visit_chats(rows)


class TestHasEntryBetween:
    """Полуинтервал [start, end): запись ровно в полночь — уже следующих суток."""

    START = datetime(2026, 10, 6, 19, 0, tzinfo=UTC)  # полночь 7.10 в Ташкенте
    END = datetime(2026, 10, 7, 19, 0, tzinfo=UTC)

    async def _patient_with_ketone_at(self, session, moment: datetime):
        patient, _ = await _family_with_chats(session, 1)
        await diary.create(
            session,
            KetoneLog,
            patient_id=patient.id,
            occurred_at=moment,
            source=DiarySource.WEB,
            created_by=None,
            fields={"value": Decimal("2.5"), "method": KetoneMethod.BLOOD},
        )
        return patient

    async def _has(self, session, patient) -> bool:
        return await diary.has_entry_between(
            session, [KetoneLog], patient_id=patient.id, start=self.START, end=self.END
        )

    async def test_entry_at_the_start_counts(self, session):
        patient = await self._patient_with_ketone_at(session, self.START)
        assert await self._has(session, patient) is True

    async def test_entry_at_the_end_belongs_to_the_next_day(self, session):
        patient = await self._patient_with_ketone_at(session, self.END)
        assert await self._has(session, patient) is False

    async def test_entry_a_moment_before_the_start_does_not_count(self, session):
        patient = await self._patient_with_ketone_at(session, self.START - timedelta(seconds=1))
        assert await self._has(session, patient) is False

    async def test_other_models_are_not_consulted(self, session):
        patient = await self._patient_with_ketone_at(session, self.START + timedelta(hours=1))
        found = await diary.has_entry_between(
            session, [WeightLog], patient_id=patient.id, start=self.START, end=self.END
        )
        assert found is False

    async def test_soft_deleted_entry_does_not_count(self, session):
        patient = await self._patient_with_ketone_at(session, self.START + timedelta(hours=1))
        [log], _ = await diary.list_for_patient(session, KetoneLog, patient_id=patient.id)
        await diary.soft_delete(session, log=log)
        assert await self._has(session, patient) is False


class TestHasEatenOn:
    """Отметка «съедено» — тоже запись о дне, и день — дата плана."""

    async def _menu_with_item(self, session, *, day: date, eaten: bool):
        patient, _ = await _family_with_chats(session, 1)
        menu = await menus.upsert(session, patient_id=patient.id, menu_date=day, created_by=None)
        session.add(
            MenuItem(
                menu_id=menu.id,
                patient_id=patient.id,
                meal_index=1,
                portion_factor=1,
                eaten=eaten,
            )
        )
        await session.flush()
        return patient

    async def test_eaten_mark_on_the_day_counts(self, session):
        patient = await self._menu_with_item(session, day=date(2026, 10, 7), eaten=True)
        assert await menus.has_eaten_on(session, patient_id=patient.id, day=date(2026, 10, 7))

    async def test_plan_without_marks_does_not_count(self, session):
        patient = await self._menu_with_item(session, day=date(2026, 10, 7), eaten=False)
        assert not await menus.has_eaten_on(session, patient_id=patient.id, day=date(2026, 10, 7))

    async def test_mark_on_another_day_does_not_count(self, session):
        patient = await self._menu_with_item(session, day=date(2026, 10, 6), eaten=True)
        assert not await menus.has_eaten_on(session, patient_id=patient.id, day=date(2026, 10, 7))
