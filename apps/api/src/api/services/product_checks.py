"""Проверка базы продуктов на аномалии (раздел 10.1 ТЗ, `content_draft`).

**Считается арифметикой, а не моделью.** Раздел 10.1 перечисляет проверку среди
задач ИИ, но называет ровно две: «значения вне физиологичных диапазонов» и
«сумма макросов > 100 г». И то и другое — счёт, а счёт, отданный модели,
становится непроверяемым: администратор увидит список подозрительных строк и не
сможет сказать, почему именно эти. Расхождение с ТЗ записано в ADR-0024.

**Границы — те же, что у импорта.** `product_import` уже отклоняет строки за
пределами диапазонов; здесь тот же модуль смотрит на то, что в базе уже лежит —
сиды, ручные правки, импорт до появления проверок. Две копии границ разошлись бы,
и продукт, который импорт не пропустил бы сегодня, спокойно жил бы в базе.

**Коэффициенты энергетической ценности — из ядра** (`keto_engine.constants`), а
не отсюда: 9/4/4 ккал на грамм — медицинская константа, и место у неё одно
(правило 1 CLAUDE.md).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from keto_engine.constants import KCAL_PER_G_CARBS, KCAL_PER_G_FAT, KCAL_PER_G_PROTEIN

from .product_import import KCAL_MAX, MACRO_MAX


class Anomaly(StrEnum):
    MACRO_SUM = "macro_sum"
    MACRO_RANGE = "macro_range"
    KCAL_RANGE = "kcal_range"
    KCAL_MISMATCH = "kcal_mismatch"
    ALL_ZERO = "all_zero"


#: Насколько объявленная калорийность может расходиться с расчётной.
#:
#: Расхождение неизбежно и у безупречных таблиц: производитель округляет,
#: считает по своим коэффициентам, учитывает органические кислоты и полиолы,
#: которых в наших четырёх полях нет вовсе. Порог выбран так, чтобы молчать на
#: обычной погрешности и говорить о перепутанных колонках и килоджоулях,
#: записанных как килокалории (разница в 4,2 раза). Это порог предупреждения
#: администратору, а не клиническая величина: расчёт меню им не пользуется.
KCAL_MISMATCH_FRACTION = 0.35

#: Нижняя граница расхождения в абсолютных величинах: у продукта на 12 ккал
#: треть — это четыре килокалории, и доля сама по себе кричала бы на каждом
#: огурце.
KCAL_MISMATCH_MIN = 25.0


@dataclass(frozen=True, slots=True)
class ProductAnomaly:
    """Одна находка по одному продукту."""

    kind: Anomaly
    #: Что именно не сходится — числами, чтобы администратор проверил сам.
    detail: str


@dataclass(frozen=True, slots=True)
class Values:
    """Значения продукта на 100 г — ровно то, по чему считаются проверки."""

    kcal: float
    fat: float
    protein: float
    carbs: float
    fiber: float


def expected_kcal(values: Values) -> float:
    """Калорийность по макронутриентам (коэффициенты — из ядра)."""

    return (
        values.fat * KCAL_PER_G_FAT
        + values.protein * KCAL_PER_G_PROTEIN
        + values.carbs * KCAL_PER_G_CARBS
    )


def check(values: Values) -> list[ProductAnomaly]:
    """Все находки по продукту, от самой определённой к самой спорной."""

    found: list[ProductAnomaly] = []

    macro_sum = values.fat + values.protein + values.carbs
    if macro_sum > MACRO_MAX:
        found.append(
            ProductAnomaly(
                Anomaly.MACRO_SUM,
                f"жиры, белки и углеводы дают {macro_sum:g} г на 100 г продукта",
            )
        )

    for name, value in (
        ("жиры", values.fat),
        ("белки", values.protein),
        ("углеводы", values.carbs),
        ("клетчатка", values.fiber),
    ):
        if value > MACRO_MAX:
            found.append(
                ProductAnomaly(Anomaly.MACRO_RANGE, f"{name}: {value:g} г на 100 г продукта")
            )

    if values.kcal > KCAL_MAX:
        found.append(ProductAnomaly(Anomaly.KCAL_RANGE, f"{values.kcal:g} ккал на 100 г"))

    if macro_sum == 0 and values.kcal > 0:
        # Калории без единого макронутриента: либо колонки пусты, либо продукт
        # завели «чтобы был». В меню он даст калории из ниоткуда.
        found.append(
            ProductAnomaly(Anomaly.ALL_ZERO, f"{values.kcal:g} ккал при нулевых макронутриентах")
        )
    elif _kcal_mismatch(values):
        expected = expected_kcal(values)
        found.append(
            ProductAnomaly(
                Anomaly.KCAL_MISMATCH,
                f"заявлено {values.kcal:g} ккал, по макронутриентам выходит {expected:.0f}",
            )
        )

    return found


def _kcal_mismatch(values: Values) -> bool:
    expected = expected_kcal(values)
    difference = abs(values.kcal - expected)
    if difference <= KCAL_MISMATCH_MIN:
        return False
    reference = max(expected, values.kcal)
    return reference > 0 and difference / reference > KCAL_MISMATCH_FRACTION
