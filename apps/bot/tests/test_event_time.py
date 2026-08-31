"""Разбор времени события, введённого в чате."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from bot.event_time import MAX_BACKDATE, TimeError, parse_moment

TZ = "Asia/Tashkent"
# 30 августа 2026, 20:00 по Ташкенту (UTC+5) — вечер, когда родитель садится
# записывать то, что было утром.
NOW = datetime(2026, 8, 30, 15, 0, tzinfo=UTC)


def _parse(raw: str, now: datetime = NOW):
    return parse_moment(raw, now=now, tz=TZ)


class TestTimeOnly:
    def test_morning_measurement_recorded_in_the_evening(self) -> None:
        # Ровно тот случай, ради которого всё: утренний кетоз и вечерний —
        # разные вещи, а бот ставил обоим момент отправки.
        moment = _parse("07:30")
        assert isinstance(moment, datetime)
        # 07:30 по Ташкенту — это 02:30 UTC того же дня.
        assert moment == datetime(2026, 8, 30, 2, 30, tzinfo=UTC)

    @pytest.mark.parametrize("raw", ["7:30", "07.30", "07 30"])
    def test_common_separators_accepted(self, raw: str) -> None:
        assert isinstance(_parse(raw), datetime)

    def test_future_time_today_is_refused(self) -> None:
        # 23:00 при местных 20:00 — это ещё не наступило.
        assert _parse("23:00") == TimeError("future")

    @pytest.mark.parametrize("raw", ["25:00", "07:60", "вчера", "", "7"])
    def test_nonsense_is_refused(self, raw: str) -> None:
        assert _parse(raw) == TimeError("format")


class TestDateAndTime:
    def test_yesterday_evening(self) -> None:
        moment = _parse("29.08 21:00")
        assert moment == datetime(2026, 8, 29, 16, 0, tzinfo=UTC)

    def test_too_old_is_refused(self) -> None:
        # Защита от опечатки: «01.09» вместо «01.10» уехало бы на месяц назад,
        # и это увидел бы врач, а не тот, кто вводил.
        old = NOW - MAX_BACKDATE - timedelta(days=1)
        local = old.astimezone().strftime("%d.%m")
        assert _parse(f"{local} 10:00") == TimeError("too_old")

    def test_december_recorded_in_january_is_last_year(self) -> None:
        january = datetime(2027, 1, 1, 10, 0, tzinfo=UTC)
        moment = _parse("31.12 22:00", now=january)
        assert isinstance(moment, datetime)
        assert moment.year == 2026

    def test_impossible_date_is_refused(self) -> None:
        assert _parse("31.02 10:00") == TimeError("format")


class TestYearRollover:
    """Год в вводе не указан, и «ещё не наступило» бывает разным."""

    def test_tomorrow_is_a_typo_not_last_year(self) -> None:
        # Молча унести запись на год назад — худший из возможных ответов:
        # семья увидит «Записано ✓», а врач не увидит записи вовсе.
        assert _parse("31.08 10:00") == TimeError("future")

    def test_december_in_january_is_last_year(self) -> None:
        january = datetime(2027, 1, 2, 10, 0, tzinfo=UTC)
        moment = _parse("31.12 22:00", now=january)
        assert isinstance(moment, datetime) and moment.year == 2026
