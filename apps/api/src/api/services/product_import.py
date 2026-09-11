"""CSV-импорт продуктов (раздел 5.3 ТЗ: `POST /products/import`, admin).

Раздел 8.3 ТЗ требует "CSV-импорт с превью и отчётом об ошибках построчно",
поэтому парсинг отделён от записи: сначала строится отчёт по всем строкам,
и только при отсутствии ошибок (или в режиме dry_run=false) данные пишутся.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from .csv_numbers import parse_decimal

REQUIRED_COLUMNS = (
    "name_ru",
    "category",
    "kcal_100g",
    "fat_100g",
    "protein_100g",
    "carbs_100g",
    "fiber_100g",
    "source",
    "source_version",
    "verified_at",
)

OPTIONAL_COLUMNS = ("name_uz", "name_en")

# Физиологичные границы значений на 100 г — отсекают явные ошибки ввода
# (перепутанные колонки, значения в кДж вместо ккал). 100 г макронутриентов на
# 100 г продукта — верхняя граница по определению; предел калорийности опирается
# на проверку аномалий из раздела 10.1 ТЗ.
#
# Имена публичные: тем же границам подчиняется проверка уже загруженной базы
# (`product_checks`), и две копии однажды разошлись бы.
MACRO_MAX = 100.0
KCAL_MAX = 1000.0

#: Допуск на округление СУММЫ жиров, белков и углеводов, граммов на 100 г.
#:
#: Источник округляет каждый нутриент отдельно, и у почти чистых жиров сумма
#: выходит за 100 на сотые доли: льняное масло в USDA (fdc 167702) — жиры
#: 99,98 г и белки 0,11 г, в сумме 100,09. Допуск открывает только полосу от
#: 100 до 100,5 г: ошибка того же размера ниже 100 г проходила всегда. Грубые
#: ошибки переноса эта проверка и раньше ловила не все: переставленные жиры,
#: белки и углеводы сумму не меняют, калорийность выше 100 ккал в колонке
#: макронутриента отсекает граница поля, а килоджоули вместо килокалорий —
#: `KCAL_MAX` при импорте и проверка расхождения калорийности уже загруженной
#: базы (`product_checks`).
#: Ответ клиники 09.09.2026 на вопрос 27: «допустимо».
#:
#: К отдельным полям допуск не относится: 100,3 г жира на 100 г продукта —
#: не округление, а ошибка.
MACRO_SUM_ROUNDING_G = 0.5


def macro_sum_exceeds_limit(fat: float, protein: float, carbs: float) -> bool:
    """Сумма макронутриентов на 100 г больше возможной с учётом округления.

    Одно правило на три двери — импорт, ручное заведение продукта и проверку
    уже загруженной базы: продукт, который пропускает одна из них, иначе
    отклоняла бы другая.

    **Складывает сама, а не принимает готовую сумму.** Двери складывали
    по-разному: импорт — `sum()`, который с Python 3.12 компенсирует ошибку
    сложения дробей, схема и проверка базы — `+`, который её копит. На 99,01 +
    0,12 + 1,37 первый даёт ровно 100,5, второй — 100.50000000000001, и одна
    дверь принимала бы продукт, а другая отклоняла.

    Сумма округляется до микрограммов перед сравнением: иначе граница зависела
    бы от того, какими числами набраны ровно 100,5 г.
    """

    return round(fat + protein + carbs, 6) > MACRO_MAX + MACRO_SUM_ROUNDING_G


def macro_sum_message(macro_sum: float) -> str:
    """Текст отказа — один на импорт и ручное заведение."""

    def grams(value: float) -> str:
        return f"{value:g}".replace(".", ",")

    return (
        f"Сумма жиров, белков и углеводов ({grams(macro_sum)} г) превышает 100 г на 100 г "
        f"продукта. Допуск на округление источника — {grams(MACRO_SUM_ROUNDING_G)} г."
    )


@dataclass(slots=True)
class RowError:
    line: int
    column: str | None
    message: str


@dataclass(slots=True)
class ValidRow:
    """Разобранная строка вместе с её номером в файле.

    Номер хранится явно: `valid_rows` не сплошной — строки с ошибками в него не
    попадают, поэтому позиция в списке не совпадает с номером строки в CSV, и
    нумерация «по индексу» приписывала бы ошибки не тем строкам.
    """

    line: int
    values: dict[str, Any]


@dataclass(slots=True)
class ImportReport:
    total_rows: int = 0
    valid_rows: list[ValidRow] = field(default_factory=list)
    errors: list[RowError] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def parse_csv(content: bytes) -> ImportReport:
    """Разбирает CSV, проверяя каждую строку. Не пишет в БД."""

    report = ImportReport()

    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        report.errors.append(RowError(0, None, "Файл должен быть в кодировке UTF-8."))
        return report

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        report.errors.append(RowError(0, None, "Файл пуст."))
        return report

    missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        report.errors.append(
            RowError(1, None, f"Отсутствуют обязательные колонки: {', '.join(missing)}")
        )
        return report

    for line_no, raw_row in enumerate(reader, start=2):
        report.total_rows += 1
        parsed, row_errors = _parse_row(raw_row, line_no)
        if row_errors:
            report.errors.extend(row_errors)
        else:
            report.valid_rows.append(ValidRow(line=line_no, values=parsed))

    if report.total_rows == 0:
        report.errors.append(RowError(1, None, "В файле нет строк с данными."))

    _flag_duplicates_within_file(report)
    return report


def _flag_duplicates_within_file(report: ImportReport) -> None:
    """Одно и то же название дважды в одном файле — тоже дубль.

    Проверка существующих в базе имён этот случай не ловит (в базе их ещё нет),
    а импортировать две записи с одним названием и разными значениями нельзя:
    при составлении меню будет выбран «не тот» продукт.
    Сравнение регистронезависимое — «Масло» и «масло» это один продукт.
    """

    seen: dict[str, int] = {}
    kept: list[ValidRow] = []

    for row in report.valid_rows:
        key = row.values["name_ru"].casefold().strip()
        first_line = seen.get(key)
        if first_line is not None:
            report.errors.append(
                RowError(
                    row.line,
                    "name_ru",
                    f"Название «{row.values['name_ru']}» уже встречается в строке {first_line}.",
                )
            )
            continue
        seen[key] = row.line
        kept.append(row)

    report.valid_rows = kept


#: Предел длины текстовых полей — тот же, что в схеме БД (`String(255)`).
#:
#: Разбор его не проверял, и строка с длинным названием проходила превью без
#: единого замечания, а на самом импорте база отвечала отказом — то есть 500 и
#: непонятно на какой строке. Превью, которое обещает успех и не выполняет
#: обещание, хуже отсутствия превью.
_TEXT_MAX = 255


def _text_field(
    row: dict[str, str | None],
    column: str,
    line_no: int,
    *,
    required: bool,
    required_message: str = "Поле обязательно.",
) -> tuple[str, list[RowError]]:
    errors: list[RowError] = []
    value = (row.get(column) or "").strip()

    if required and not value:
        errors.append(RowError(line_no, column, required_message))
    elif len(value) > _TEXT_MAX:
        errors.append(
            RowError(
                line_no,
                column,
                f"Длина {len(value)} символов превышает допустимые {_TEXT_MAX}.",
            )
        )
    return value, errors


def _parse_row(row: dict[str, str | None], line_no: int) -> tuple[dict[str, Any], list[RowError]]:
    errors: list[RowError] = []
    parsed: dict[str, Any] = {}

    name, name_errors = _text_field(
        row, "name_ru", line_no, required=True, required_message="Название обязательно."
    )
    errors.extend(name_errors)
    parsed["name_ru"] = name

    for column in OPTIONAL_COLUMNS:
        value, column_errors = _text_field(row, column, line_no, required=False)
        errors.extend(column_errors)
        parsed[column] = value or None

    for column in ("source", "source_version", "category"):
        value, column_errors = _text_field(row, column, line_no, required=True)
        errors.extend(column_errors)
        parsed[column] = value

    for column, limit in (
        ("kcal_100g", KCAL_MAX),
        ("fat_100g", MACRO_MAX),
        ("protein_100g", MACRO_MAX),
        ("carbs_100g", MACRO_MAX),
        ("fiber_100g", MACRO_MAX),
    ):
        raw_value = (row.get(column) or "").strip()
        # Не `float`: он принимает «nan», «inf», «1e2» и «1_00», и NaN не
        # проходит ни одно сравнение ниже (`csv_numbers`).
        number = parse_decimal(raw_value)
        if number is None:
            errors.append(RowError(line_no, column, f"Ожидалось число, получено: {raw_value!r}."))
            continue
        if number < 0:
            errors.append(RowError(line_no, column, "Значение не может быть отрицательным."))
        elif number > limit:
            errors.append(
                RowError(line_no, column, f"Значение {number:g} превышает допустимое ({limit:g}).")
            )
        parsed[column] = number

    raw_date = (row.get("verified_at") or "").strip()
    try:
        parsed["verified_at"] = date.fromisoformat(raw_date)
    except ValueError:
        errors.append(
            RowError(
                line_no,
                "verified_at",
                f"Ожидалась дата в формате ГГГГ-ММ-ДД, получено: {raw_date!r}.",
            )
        )

    fat, protein, carbs = (parsed.get(c) for c in ("fat_100g", "protein_100g", "carbs_100g"))
    if (
        isinstance(fat, float)
        and isinstance(protein, float)
        and isinstance(carbs, float)
        and macro_sum_exceeds_limit(fat, protein, carbs)
    ):
        errors.append(RowError(line_no, None, macro_sum_message(fat + protein + carbs)))

    # `carbs_100g` — углеводы ВМЕСТЕ с клетчаткой. Ядро вычитает её из знаменателя
    # соотношения (ADR-0030), и эта проверка — единственное место, где конвенция
    # источника вообще проверяется. Источник с раздельным учётом она отклонит:
    # отказ здесь дешевле тихого второго вычитания в каждом расчёте.
    #
    # TODO(med): вопрос 47 — как записаны углеводы в таблице местных продуктов
    # клиники. Российские и советские таблицы приводят их БЕЗ клетчатки
    # (см. infra/seed/README.md), и такую таблицу пересчитывать надо построчно.
    fiber = parsed.get("fiber_100g")
    carbs = parsed.get("carbs_100g")
    if isinstance(fiber, float) and isinstance(carbs, float) and fiber > carbs:
        errors.append(
            RowError(
                line_no,
                "fiber_100g",
                f"Клетчатка ({fiber:g} г) не может превышать общие углеводы ({carbs:g} г).",
            )
        )

    return parsed, errors
