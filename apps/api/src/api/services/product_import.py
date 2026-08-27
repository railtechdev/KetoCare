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
# (перепутанные колонки, значения в кДж вместо ккал).
_MACRO_MAX = 100.0
_KCAL_MAX = 1000.0


@dataclass(slots=True)
class RowError:
    line: int
    column: str | None
    message: str


@dataclass(slots=True)
class ImportReport:
    total_rows: int = 0
    valid_rows: list[dict[str, Any]] = field(default_factory=list)
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
            report.valid_rows.append(parsed)

    if report.total_rows == 0:
        report.errors.append(RowError(1, None, "В файле нет строк с данными."))

    return report


def _parse_row(row: dict[str, str | None], line_no: int) -> tuple[dict[str, Any], list[RowError]]:
    errors: list[RowError] = []
    parsed: dict[str, Any] = {}

    name = (row.get("name_ru") or "").strip()
    if not name:
        errors.append(RowError(line_no, "name_ru", "Название обязательно."))
    parsed["name_ru"] = name

    for column in OPTIONAL_COLUMNS:
        value = (row.get(column) or "").strip()
        parsed[column] = value or None

    for column in ("source", "source_version", "category"):
        value = (row.get(column) or "").strip()
        if not value:
            errors.append(RowError(line_no, column, "Поле обязательно."))
        parsed[column] = value

    for column, limit in (
        ("kcal_100g", _KCAL_MAX),
        ("fat_100g", _MACRO_MAX),
        ("protein_100g", _MACRO_MAX),
        ("carbs_100g", _MACRO_MAX),
        ("fiber_100g", _MACRO_MAX),
    ):
        raw_value = (row.get(column) or "").strip().replace(",", ".")
        try:
            number = float(raw_value)
        except ValueError:
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

    macros = [parsed.get(c) for c in ("fat_100g", "protein_100g", "carbs_100g")]
    if all(isinstance(m, float) for m in macros):
        macro_sum = sum(macros)  # type: ignore[arg-type]
        if macro_sum > _MACRO_MAX:
            errors.append(
                RowError(
                    line_no,
                    None,
                    f"Сумма жиров, белков и углеводов ({macro_sum:g} г) превышает 100 г на 100 г продукта.",
                )
            )

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
