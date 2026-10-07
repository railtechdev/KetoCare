"""«Запись за сегодня уже есть» — какие сутки и какие записи (раздел 7.4 ТЗ).

Две находки, которые держат эти тесты (наполнение базы знаний, 07.10.2026):

- окно шло от вчерашней полуночи UTC до конца завтрашних суток UTC — трое
  суток, и вчерашний вечерний замер снимал сегодняшнее напоминание. Сутки —
  местные, по часовому поясу установки;
- вечернее «за сегодня нет записей» считало только кетоны, вес и препараты, а
  само советовало отметить самочувствие — которое его не снимало.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from core.models import (
    KetoneLog,
    MealLog,
    MedicationLog,
    MenuItem,
    SeizureLog,
    SeizureType,
    SideEffectLog,
    WeightLog,
)
from core.models.enums import DiarySource, KetoneMethod
from core.repositories import diary as diary_repo
from core.repositories import menus as menus_repo
from worker.reminders.task import _already_recorded, day_window

TASHKENT = ZoneInfo("Asia/Tashkent")  # UTC+5, без перехода на летнее время
DAY = date(2026, 10, 7)
#: Полночь 7 октября по Ташкенту и полночь 8-го — в UTC.
LOCAL_MIDNIGHT = datetime(2026, 10, 6, 19, 0, tzinfo=UTC)
NEXT_LOCAL_MIDNIGHT = datetime(2026, 10, 7, 19, 0, tzinfo=UTC)


class TestDayWindow:
    def test_is_the_local_day_in_utc(self) -> None:
        assert day_window(DAY, TASHKENT) == (LOCAL_MIDNIGHT, NEXT_LOCAL_MIDNIGHT)

    def test_short_day_at_a_clock_change(self) -> None:
        """Сутки перевода часов короче 24 часов: конец — полночь следующей даты."""

        berlin = ZoneInfo("Europe/Berlin")
        start, end = day_window(date(2026, 3, 29), berlin)
        assert end - start == timedelta(hours=23)


async def _log(session: Any, model: Any, patient_id: uuid.UUID, at: datetime) -> None:
    fields: dict[type, dict[str, Any]] = {
        KetoneLog: {"value": Decimal("2.5"), "method": KetoneMethod.BLOOD},
        WeightLog: {"weight_kg": Decimal("18.4")},
        SideEffectLog: {"symptom": "Самочувствие: хорошо"},
        MealLog: {"free_text": "каша"},
    }
    await diary_repo.create(
        session,
        model,
        patient_id=patient_id,
        occurred_at=at,
        source=DiarySource.BOT,
        created_by=None,
        fields=fields[model],
    )


async def _recorded(session: Any, kind: str, patient_id: uuid.UUID) -> bool:
    return await _already_recorded(
        session, kind=kind, patient_id=patient_id, day=DAY, zone=TASHKENT
    )


class TestMidnightBoundaries:
    @pytest.mark.parametrize(
        ("moment", "expected"),
        [
            (LOCAL_MIDNIGHT, True),
            (NEXT_LOCAL_MIDNIGHT - timedelta(seconds=1), True),
            # 23:59 вчера по Ташкенту — прежнее окно его засчитывало.
            (LOCAL_MIDNIGHT - timedelta(minutes=1), False),
            # Полночь следующих суток — уже завтра.
            (NEXT_LOCAL_MIDNIGHT, False),
            # 7 октября по UTC, но 8-е по Ташкенту — прежнее окно засчитывало.
            (datetime(2026, 10, 7, 20, 0, tzinfo=UTC), False),
        ],
    )
    async def test_only_the_local_day_counts(
        self,
        sessionmaker: async_sessionmaker,
        patient_id: uuid.UUID,
        moment: datetime,
        expected: bool,
    ) -> None:
        async with sessionmaker() as session:
            await _log(session, KetoneLog, patient_id, moment)
            assert await _recorded(session, "ketones", patient_id) is expected


class TestNoRecordsCountsEveryDiary:
    @pytest.mark.parametrize("model", [SideEffectLog, MealLog, WeightLog])
    async def test_any_diary_entry_cancels_it(
        self, sessionmaker: async_sessionmaker, patient_id: uuid.UUID, model: Any
    ) -> None:
        async with sessionmaker() as session:
            await _log(session, model, patient_id, LOCAL_MIDNIGHT + timedelta(hours=9))
            assert await _recorded(session, "no_records", patient_id) is True

    async def test_seizure_cancels_it(
        self, sessionmaker: async_sessionmaker, patient_id: uuid.UUID
    ) -> None:
        async with sessionmaker() as session:
            # Справочник типов приступов засеян миграцией.
            seizure_type_id = await session.scalar(select(SeizureType.id).limit(1))
            session.add(
                SeizureLog(
                    patient_id=patient_id,
                    seizure_type_id=seizure_type_id,
                    occurred_at=LOCAL_MIDNIGHT + timedelta(hours=9),
                    source=DiarySource.BOT,
                )
            )
            await session.flush()
            assert await _recorded(session, "no_records", patient_id) is True

    async def test_eaten_mark_in_todays_plan_cancels_it(
        self, sessionmaker: async_sessionmaker, patient_id: uuid.UUID
    ) -> None:
        async with sessionmaker() as session:
            menu = await menus_repo.upsert(
                session, patient_id=patient_id, menu_date=DAY, created_by=None
            )
            session.add(
                MenuItem(
                    menu_id=menu.id,
                    patient_id=patient_id,
                    meal_index=1,
                    portion_factor=1,
                    eaten=True,
                )
            )
            await session.flush()
            assert await _recorded(session, "no_records", patient_id) is True

    async def test_empty_day_still_gets_it(
        self, sessionmaker: async_sessionmaker, patient_id: uuid.UUID
    ) -> None:
        async with sessionmaker() as session:
            # Вчерашняя запись сегодняшний день не заполняет.
            await _log(session, SideEffectLog, patient_id, LOCAL_MIDNIGHT - timedelta(hours=1))
            assert await _recorded(session, "no_records", patient_id) is False

    async def test_wellbeing_does_not_cancel_a_ketone_reminder(
        self, sessionmaker: async_sessionmaker, patient_id: uuid.UUID
    ) -> None:
        """Напоминание о замере снимает только тот же замер."""

        async with sessionmaker() as session:
            await _log(session, SideEffectLog, patient_id, LOCAL_MIDNIGHT + timedelta(hours=9))
            assert await _recorded(session, "ketones", patient_id) is False


def test_every_family_diary_is_counted() -> None:
    """Новый вид дневника без строки здесь снова дал бы «нет записей» при записи."""

    from worker.reminders.task import _ANY_DIARY_MODELS

    assert set(_ANY_DIARY_MODELS) == {
        SeizureLog,
        KetoneLog,
        WeightLog,
        MedicationLog,
        MealLog,
        SideEffectLog,
    }
