"""Сверка чисел сводки с переданными рядами.

Проверка, ради которой всё затевалось: лексический фильтр — эвристика, а
множество допустимых чисел известно точно. Самый важный случай здесь — пустой
период: если кетонов не было ни одного, а раздел «Кетоны» полон цифр, выдумано
всё до последней.
"""

from __future__ import annotations

from typing import Any

from worker.ai.grounding import check, collect_numbers

PAYLOAD: dict[str, Any] = {
    "period": {"from": "2026-08-01", "to": "2026-08-31", "days": 31},
    "anthropometry": {"age_months": 52, "sex": "f", "height_cm": 104.0},
    "seizures": {"entries": 9, "count": 14, "days_with_seizures": 9},
    "ketones": {
        "blood": {"measurements": 28, "min": 1.9, "max": 3.2, "mean": 2.4},
        "urine": {"measurements": 0, "min": None, "max": None, "mean": None},
    },
    "weight": {
        "measurements": 4,
        "first": {"date": "2026-08-01", "kg": 14.2},
        "last": {"date": "2026-08-29", "kg": 14.0},
        "delta_kg": -0.2,
    },
    "medications": [
        {"drug_name": "Ламотриджин", "dose": "25 мг", "entries": 30, "taken": 26, "taken_pct": 86.7}
    ],
}


class TestGrounded:
    def test_numbers_from_the_payload_pass(self) -> None:
        text = (
            "За период записано 14 приступов в 9 днях. "
            "Кетоны крови: 28 замеров, от 1.9 до 3.2 ммоль/л, в среднем 2.4."
        )
        assert check(text, PAYLOAD) == []

    def test_a_difference_of_two_passed_numbers_passes(self) -> None:
        """«Снижение на 0.2 кг» — прямой счёт, который промпт разрешает."""

        assert check("Вес 14.2 кг на 01.08 и 14.0 кг на 29.08, снижение на 0.2 кг.", PAYLOAD) == []

    def test_a_share_computed_by_us_passes(self) -> None:
        """Доля считается сборкой нагрузки, а не моделью.

        Проверка не выводит долей сама: с полусотней чисел попарные доли
        покрывают почти всё пространство значений, и выдумка проходила бы как
        «частное двух обоснованных». Поэтому `taken_pct` лежит в нагрузке.
        """

        assert check("Ламотриджин: отмечено 26 приёмов из 30, это 86.7%.", PAYLOAD) == []

    def test_a_share_the_model_computed_itself_is_a_finding(self) -> None:
        """Обратная сторона того же решения: округлённое до 87 % — находка.

        Мягкая: врач увидит подсвеченную цифру и решит сам. Цена ошибки в эту
        сторону — лишняя подсветка; в другую — незамеченное число в документе,
        по которому принимают решение.
        """

        found = check("Приверженность 87%.", PAYLOAD)
        assert [item.value for item in found] == [87.0]

    def test_dose_from_a_string_value_passes(self) -> None:
        assert check("Ламотриджин 25 мг — отмечено 26 приёмов.", PAYLOAD) == []

    def test_a_date_inside_the_period_passes(self) -> None:
        assert check("Записей нет с 20 по 22.08.", PAYLOAD) == []

    def test_ordinals_within_the_period_pass(self) -> None:
        """«Три дня подряд», «вторая неделя» — счёт по рядам, а не выдумка."""

        assert check("Три дня подряд без записей пришлись на вторую неделю.", PAYLOAD) == []

    def test_a_comma_decimal_matches_a_dot_decimal(self) -> None:
        assert check("В среднем 2,4 ммоль/л.", PAYLOAD) == []


class TestUngrounded:
    def test_a_value_outside_the_series_is_found(self) -> None:
        found = check("Кетоны выросли с 2.1 до 4.3 ммоль/л.", PAYLOAD)
        assert [item.value for item in found] == [2.1, 4.3]

    def test_an_empty_series_makes_every_number_a_finding(self) -> None:
        """Самый дешёвый и самый важный случай: замеров не было вовсе.

        Раздел заполнен числами, а множество допустимых пусто — проверка
        срабатывает сама, без единого правила.
        """

        empty = {"period": {"from": "2026-08-01", "to": "2026-08-31", "days": 31}, "ketones": {}}
        found = check("Кетоны держались около 2.6 ммоль/л, максимум 3.9.", empty)
        assert [item.value for item in found] == [2.6, 3.9]

    def test_a_date_outside_the_period_is_found(self) -> None:
        found = check("Приступ 14.09 записан отдельно.", PAYLOAD)
        assert found and found[0].fragment.startswith("приступ")

    def test_the_fragment_names_the_sentence(self) -> None:
        """Врач должен видеть, что подсвечено, а не факт срабатывания."""

        found = check("Вес вырос до 19.7 кг.", PAYLOAD)
        assert found[0].fragment == "вес вырос до 19.7 кг"


class TestCollect:
    def test_numbers_are_collected_at_any_depth(self) -> None:
        numbers = collect_numbers(PAYLOAD)
        assert {14.0, 1.9, 3.2, 14.2, 25.0} <= numbers

    def test_booleans_are_not_numbers(self) -> None:
        """`True` в Python — единица; принять её за величину нельзя."""

        assert collect_numbers({"eaten": True, "planned": False}) == set()

    def test_iso_dates_are_not_read_as_numbers(self) -> None:
        assert collect_numbers({"date": "2026-08-01"}) == set()
