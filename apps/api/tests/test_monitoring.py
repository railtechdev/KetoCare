"""Режим наблюдения за пациентом — вопрос 11, без базы.

Границы режима — медицинское правило, поэтому каждая проверена по обе стороны:
день начала и накануне, последний день строгого месяца и первый день после.
"""

from __future__ import annotations

from datetime import date

from api.schemas_overview import MonitoringPhase
from api.services.monitoring import STRICT_MONITORING_MONTHS, add_months, monitoring_phase


class TestAddMonths:
    def test_same_day_next_month(self) -> None:
        assert add_months(date(2026, 3, 15), 1) == date(2026, 4, 15)

    def test_missing_day_is_pressed_to_the_month_end(self) -> None:
        """С 31 января — до 28 февраля, а не до 3 марта.

        `timedelta(days=31)` или наивная замена месяца дали бы либо чужой месяц,
        либо исключение на несуществующей дате.
        """

        assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
        assert add_months(date(2028, 1, 31), 1) == date(2028, 2, 29)

    def test_year_rolls_over(self) -> None:
        assert add_months(date(2026, 12, 15), 1) == date(2027, 1, 15)


class TestMonitoringPhase:
    START = date(2026, 3, 15)

    def test_the_strict_period_is_one_month(self) -> None:
        """Число из ответа клиники: «например, в течение месяца».

        Проверка стоит, чтобы смена константы не прошла молча: вместе с ней
        меняется и смысл подписи «первый месяц терапии» в кабинете.
        """

        assert STRICT_MONITORING_MONTHS == 1

    def test_no_start_date_means_therapy_has_not_started(self) -> None:
        assert monitoring_phase(started_on=None, today=self.START) is MonitoringPhase.BEFORE_START

    def test_the_day_before_start_is_not_therapy_yet(self) -> None:
        assert (
            monitoring_phase(started_on=self.START, today=date(2026, 3, 14))
            is MonitoringPhase.BEFORE_START
        )

    def test_the_start_day_is_already_strict(self) -> None:
        """День начала — уже терапия: то же строгое сравнение, что в правиле про
        исходную частоту приступов."""

        assert monitoring_phase(started_on=self.START, today=self.START) is MonitoringPhase.STRICT

    def test_the_last_day_of_the_month_is_still_strict(self) -> None:
        assert (
            monitoring_phase(started_on=self.START, today=date(2026, 4, 14))
            is MonitoringPhase.STRICT
        )

    def test_the_month_anniversary_is_already_routine(self) -> None:
        assert (
            monitoring_phase(started_on=self.START, today=date(2026, 4, 15))
            is MonitoringPhase.ROUTINE
        )
