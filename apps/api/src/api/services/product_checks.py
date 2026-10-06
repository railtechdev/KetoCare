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

from .product_import import KCAL_MAX, MACRO_MAX, macro_sum_exceeds_limit


class Anomaly(StrEnum):
    MACRO_SUM = "macro_sum"
    MACRO_RANGE = "macro_range"
    KCAL_RANGE = "kcal_range"
    KCAL_MISMATCH = "kcal_mismatch"
    ALL_ZERO = "all_zero"


# TODO(med): подтвердить у медицинской команды — клиника назвала число с
# оговоркой «например» (вопрос 1 в docs/medical/OPEN_QUESTIONS.md).
#: На сколько килокалорий на 100 г заявленная калорийность может расходиться с
#: расчётной по 9 — 4 — 4, прежде чем продукт помечается.
#:
#: Ответ клиники от 09.09.2026 на вопрос 1: «Если будет сильное превышение
#: (давайте определим, более 5 ккал например) — нужно предупреждать». Строго
#: «более»: ровно 5 ккал — не находка. Порог заменил прежний наш (треть и
#: 25 ккал, вопрос 43): ответ клиники пришёл раньше нашего решения и остаётся в
#: силе по правилу заказчика.
#:
#: Расхождение есть и у безупречных таблиц — USDA считает калорийность по
#: собственным коэффициентам Этуотера для каждого продукта, производитель
#: округляет, — поэтому на справочнике из USDA пометок будет много. Замер
#: 06.10.2026: 11 продуктов из 16 известных нам (сиды, шаблон импорта, база
#: разработки) расходятся больше чем на 5 ккал, по прежнему порогу — ни один.
#: Это предупреждение, а не запрет: расчёт меню порогом не пользуется, он
#: считает калорийность из состава всегда.
KCAL_MISMATCH_KCAL = 5.0


@dataclass(frozen=True, slots=True)
class ProductAnomaly:
    """Одна находка по одному продукту.

    Наружу идут класс и числа, а не готовая фраза: текст живёт в словарях
    фронтенда (правило 8 CLAUDE.md), и формулировку можно согласовать, не трогая
    бэкенд. Собранное здесь русское предложение обошло бы i18n стороной.
    """

    kind: Anomaly
    #: Числа, по которым администратор проверит сам. Ключи — имена подстановок в
    #: словаре.
    values: dict[str, float]
    #: Какое поле не в порядке (для `macro_range`) — кодом, не подписью.
    field: str = ""


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
    if macro_sum_exceeds_limit(values.fat, values.protein, values.carbs):
        found.append(ProductAnomaly(Anomaly.MACRO_SUM, {"sum": round(macro_sum, 2)}))

    for field, value in (
        ("fat", values.fat),
        ("protein", values.protein),
        ("carbs", values.carbs),
        ("fiber", values.fiber),
    ):
        if value > MACRO_MAX:
            found.append(
                ProductAnomaly(Anomaly.MACRO_RANGE, {"value": round(value, 2)}, field=field)
            )

    if values.kcal > KCAL_MAX:
        found.append(ProductAnomaly(Anomaly.KCAL_RANGE, {"kcal": round(values.kcal, 2)}))

    if macro_sum == 0 and values.kcal > 0:
        # Калории без единого макронутриента: либо колонки пусты, либо продукт
        # завели «чтобы был». В меню он даст калории из ниоткуда.
        found.append(ProductAnomaly(Anomaly.ALL_ZERO, {"kcal": round(values.kcal, 2)}))
    elif _kcal_mismatch(values):
        found.append(
            ProductAnomaly(
                Anomaly.KCAL_MISMATCH,
                {
                    "declared": round(values.kcal, 2),
                    "expected": round(expected_kcal(values)),
                },
            )
        )

    return found


def _kcal_mismatch(values: Values) -> bool:
    # Округление до сотых — против двоичного представления: 4,2 + 0,8 ккал не
    # должно стать «5,000000001 — больше пяти».
    return round(abs(values.kcal - expected_kcal(values)), 6) > KCAL_MISMATCH_KCAL
