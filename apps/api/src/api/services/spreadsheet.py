"""Таблица Excel (.xlsx) как CSV.

Импорт продуктов и рецептов разбирает CSV построчно, с номерами строк и
столбцов в отчёте. Excel не заводит второй разбор: первый лист переводится в
тот же CSV, и дальше файл проходит те же проверки. Клиника ведёт таблицы в
Excel, а сохранение в CSV с нужной кодировкой — шаг, на котором люди ошибаются.
"""

from __future__ import annotations

import csv
import io
import zipfile
from datetime import date, datetime

# Сигнатура ZIP: .xlsx — это ZIP-архив. Расширение имени файла не проверяется:
# его меняют руками, а содержимое нет.
_ZIP_MAGIC = b"PK\x03\x04"

# Предел строк одного листа: тот же масштаб, что у предела размера файла.
MAX_ROWS = 20_000


class SpreadsheetError(ValueError):
    """Файл похож на Excel, но прочитать его нельзя."""


def is_xlsx(content: bytes) -> bool:
    return content.startswith(_ZIP_MAGIC)


def _cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def xlsx_to_csv(content: bytes) -> bytes:
    """Первый лист книги — в CSV в UTF-8. Пустые строки в конце отбрасываются."""

    from openpyxl import load_workbook

    try:
        book = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except (zipfile.BadZipFile, KeyError, OSError, ValueError) as exc:
        raise SpreadsheetError("Файл Excel повреждён или это не .xlsx.") from exc

    try:
        sheet = book.worksheets[0]
        out = io.StringIO()
        writer = csv.writer(out, lineterminator="\n")
        for index, row in enumerate(sheet.iter_rows(values_only=True)):
            if index >= MAX_ROWS:
                raise SpreadsheetError(f"В листе больше {MAX_ROWS} строк.")
            cells = [_cell(value) for value in row]
            while cells and cells[-1] == "":
                cells.pop()
            if not cells:
                continue
            writer.writerow(cells)
    finally:
        book.close()
    return out.getvalue().encode("utf-8")
