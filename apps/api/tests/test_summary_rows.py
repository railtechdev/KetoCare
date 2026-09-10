"""Ряды сводки врача — арифметика без базы (раздел 10.5 ТЗ).

Числа сводки считает API, а не модель (ADR-0023), и здесь проверяется именно
счёт: доступ и ручки — в `test_summaries.py`. Отдельный файл ещё и потому, что
там весь модуль помечен `asyncio`, а этим тестам событийный цикл не нужен.
"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from api.services import summaries as summaries_service
from keto_engine import ENGINE_VERSION


class TestRatioDeviationDoesNotCrossEngineMajors:
    """Среднее отклонение соотношения не смешивает два правила расчёта.

    С версии ядра 1.0.0 соотношение считается по чистым углеводам (ADR-0030), и
    сохранённые дни прежних версий несут число, посчитанное иначе. Усреднить их
    вместе — значит выдать модели, а через неё врачу, величину, которой не
    существует ни по одному правилу. `/overview` по этой же причине перестал
    выносить таким дням вердикт; здесь то же решение.

    Тест на чистых функциях, без базы: считается арифметика, а не доступ.
    """

    @staticmethod
    def _day(day: date, ratio: float, engine_version: str | None):
        return SimpleNamespace(
            date=day,
            totals={"ratio": ratio, "kcal": 1200},
            engine_version=engine_version,
        )

    @staticmethod
    def _adherence():
        return SimpleNamespace(days_planned=4, items_planned=16, items_eaten=12)

    def _rows(self, days):
        history = [SimpleNamespace(effective_from=date(2026, 8, 1), ratio=3.0, kcal_per_day=1200)]
        return summaries_service._menu(self._adherence(), days, history, days_in_period=31)

    def test_days_of_a_previous_major_are_left_out_and_counted(self) -> None:
        current = ENGINE_VERSION.split(".", 1)[0]
        rows = self._rows(
            [
                # Прежнее правило: соотношение занижено, потому что считалось по
                # общим углеводам.
                self._day(date(2026, 8, 10), 2.0, "0.4.0"),
                self._day(date(2026, 8, 11), 2.0, "0.3.0"),
                # Сегодняшнее правило: ровно в цель.
                self._day(date(2026, 8, 12), 3.0, f"{current}.0.0"),
            ]
        )

        # Среднее считается по одному дню, а не по трём: иначе вышло бы −0,67 —
        # «врач увидел бы систематический недобор», которого не было.
        assert rows["days_compared"] == 1
        assert rows["ratio_mean_deviation"] == pytest.approx(0.0)
        assert rows["days_other_engine"] == 2
        assert rows["engine_versions"] == sorted({"0.4.0", "0.3.0", f"{current}.0.0"})

    def test_minor_and_patch_stay_comparable(self) -> None:
        """Расхождение по minor чисел не меняет — день остаётся в среднем."""

        current = ENGINE_VERSION.split(".", 1)[0]
        rows = self._rows(
            [
                self._day(date(2026, 8, 10), 3.2, f"{current}.99.99"),
                self._day(date(2026, 8, 11), 2.8, f"{current}.0.0"),
            ]
        )

        assert rows["days_compared"] == 2
        assert rows["days_other_engine"] == 0
        assert rows["ratio_mean_deviation"] == pytest.approx(0.0)

    def test_day_without_a_version_is_not_averaged_in(self) -> None:
        """Версия не записана — по какому правилу посчитано, неизвестно."""

        rows = self._rows([self._day(date(2026, 8, 10), 2.0, None)])

        assert rows["days_compared"] == 0
        assert rows["days_other_engine"] == 1
