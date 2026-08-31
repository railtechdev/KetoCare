"""Окно попадания и тексты напоминаний (раздел 7.4 ТЗ).

Проверяется чистая логика: когда напоминание считается «пора» и что оно
говорит. Доставка и запросы к базе — отдельная история, здесь их нет.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from worker.reminders.task import TEXTS, WINDOW, _due_kinds, _is_due

TZ = ZoneInfo("Asia/Tashkent")


class Reminder:
    """Настройки напоминаний без базы: у задачи от них нужны только поля."""

    def __init__(self, **fields: time | None) -> None:
        self.ketones_at = fields.get("ketones_at")
        self.weight_at = fields.get("weight_at")
        self.medications_at = fields.get("medications_at")
        self.no_records_at = fields.get("no_records_at")


def at(hour: int, minute: int) -> datetime:
    return datetime(2026, 8, 31, hour, minute, tzinfo=TZ)


class TestWindow:
    def test_fires_at_the_appointed_minute(self) -> None:
        assert _is_due(time(7, 30), at(7, 30)) is True

    def test_fires_within_the_window(self) -> None:
        # Задача идёт раз в пять минут, точного совпадения не бывает почти
        # никогда; при задержке очереди напоминание не должно пропасть до завтра.
        assert _is_due(time(7, 30), at(7, 34)) is True

    def test_does_not_fire_before_time(self) -> None:
        assert _is_due(time(7, 30), at(7, 29)) is False

    def test_does_not_fire_after_the_window(self) -> None:
        # Иначе напоминание «в 07:30» приходило бы в обед.
        late = at(7, 30) + WINDOW
        assert _is_due(time(7, 30), late) is False

    def test_late_evening_does_not_leak_into_the_next_day(self) -> None:
        """«23:58» не должно срабатывать в 00:02: это уже другой день.

        Записи считаются по дням, и напоминание за прошлые сутки пришло бы
        тогда, когда они уже кончились.
        """

        assert _is_due(time(23, 58), at(0, 2) + timedelta(days=0)) is False


class TestSchedule:
    def test_only_configured_kinds_are_due(self) -> None:
        reminder = Reminder(ketones_at=time(7, 30), weight_at=None)
        due = _due_kinds(reminder, at(7, 30))
        assert [kind for kind, _ in due] == ["ketones"]

    def test_nothing_is_due_at_another_hour(self) -> None:
        reminder = Reminder(ketones_at=time(7, 30), no_records_at=time(20, 0))
        assert _due_kinds(reminder, at(12, 0)) == []

    def test_several_kinds_can_coincide(self) -> None:
        reminder = Reminder(ketones_at=time(20, 0), no_records_at=time(20, 0))
        due = {kind for kind, _ in _due_kinds(reminder, at(20, 0))}
        assert due == {"ketones", "no_records"}


class TestTexts:
    @pytest.mark.parametrize("kind", ["ketones", "weight", "medications", "no_records"])
    def test_every_kind_has_a_text(self, kind: str) -> None:
        assert TEXTS[kind].strip()

    def test_no_records_does_not_blame(self) -> None:
        """Раздел 7.4 требует мягкости: упрёк выключают в первый же день."""

        assert "пропустили" not in TEXTS["no_records"]
        assert "не забыли" not in TEXTS["no_records"]
