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
        assert (
            monitoring_phase(starts=(None, None), today=self.START) is MonitoringPhase.BEFORE_START
        )

    def test_the_day_before_start_is_not_therapy_yet(self) -> None:
        assert (
            monitoring_phase(starts=(self.START, None), today=date(2026, 3, 14))
            is MonitoringPhase.BEFORE_START
        )

    def test_the_start_day_is_already_strict(self) -> None:
        """День начала — уже терапия: то же сравнение, что в правиле про
        исходную частоту приступов."""

        assert (
            monitoring_phase(starts=(None, self.START), today=self.START) is MonitoringPhase.STRICT
        )

    def test_the_last_day_of_the_month_is_still_strict(self) -> None:
        assert (
            monitoring_phase(starts=(self.START, None), today=date(2026, 4, 14))
            is MonitoringPhase.STRICT
        )

    def test_the_month_anniversary_is_already_routine(self) -> None:
        assert (
            monitoring_phase(starts=(self.START, None), today=date(2026, 4, 15))
            is MonitoringPhase.ROUTINE
        )


class TestTwoSourcesOfTheStart:
    """Дата от врача и дата первого назначения — окна объединяются.

    Пропущенный строгий месяц в списке не виден ничем, а лишний объясняет себя
    подписью «первый месяц терапии». Поэтому строгий режим идёт, пока месяц не
    истёк хотя бы от одной даты.
    """

    TODAY = date(2026, 3, 15)

    def test_a_typo_in_the_named_year_does_not_hide_the_month(self) -> None:
        """Врач ввёл «2062», назначение — от сегодня: месяц идёт от назначения."""

        assert (
            monitoring_phase(starts=(date(2062, 3, 15), self.TODAY), today=self.TODAY)
            is MonitoringPhase.STRICT
        )

    def test_an_early_prescription_does_not_end_the_named_month(self) -> None:
        """Назначение записали полгода назад, врач назвал началом прошлую неделю."""

        assert (
            monitoring_phase(starts=(date(2026, 3, 8), date(2025, 9, 1)), today=self.TODAY)
            is MonitoringPhase.STRICT
        )

    def test_routine_only_when_every_month_is_over(self) -> None:
        starts = (date(2026, 1, 10), date(2026, 2, 20))

        assert monitoring_phase(starts=starts, today=date(2026, 3, 19)) is MonitoringPhase.STRICT
        assert monitoring_phase(starts=starts, today=date(2026, 3, 20)) is MonitoringPhase.ROUTINE

    def test_a_date_still_ahead_does_not_undo_a_started_therapy(self) -> None:
        """Назначение с января, врач назвал сентябрь: терапия уже идёт.

        «Ещё не началась» здесь было бы неправдой — назначение действует, и
        семья по нему живёт. Строгого месяца тоже нет: от января он истёк, а
        сентябрь не наступил.
        """

        assert (
            monitoring_phase(starts=(date(2026, 9, 1), date(2026, 1, 1)), today=self.TODAY)
            is MonitoringPhase.ROUTINE
        )
