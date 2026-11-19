"""Выгрузка списков в Excel по единому стандарту документов (ADR-0092).

Таблица остаётся таблицей: данные с первой строки, «умная таблица» Excel с
фильтром, без объединённых ячеек и пустых строк — тогда работают сортировка,
фильтр и сводные таблицы. Бланк клиники уходит в колонтитулы печати, сведения о
выгрузке — на второй лист «Сведения» и в свойства файла.

Собирает сервер, а не кабинет: из доступных библиотек только XlsxWriter ставит
логотип в колонтитул печати (`&G`).
"""

from __future__ import annotations

import io
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Literal

import xlsxwriter

from core.letterhead import Snapshot

ColumnKind = Literal["text", "int", "decimal", "date", "bool"]


@dataclass(frozen=True)
class Column:
    title: str
    kind: ColumnKind = "text"
    width: float = 14


@dataclass(frozen=True)
class ListExport:
    """Что выгружается и как это описать на листе «Сведения»."""

    #: Имя листа с данными: осмысленное, а не «Лист1».
    sheet: str
    title: str
    #: Шифр шаблона: «KC-LIST-PRODUCTS-1».
    code: str
    columns: Sequence[Column]
    #: Значение `None` — ячейка пустая («нет данных»), а не ноль.
    rows: Sequence[Sequence[Any]]
    #: Подписи и значения листа «Сведения» сверх общих: отбор, порядок, единицы.
    about: Sequence[tuple[str, str]]


def _header_text(value: str) -> str:
    """`&` в колонтитуле — управляющий символ; строка не длиннее 255 знаков."""

    return value.replace("&", "&&")[:120]


def build_workbook(
    export: ListExport,
    *,
    letterhead: Snapshot,
    author: str | None,
    generated_at: datetime,
    logo_png: bytes | None,
    engine_version: str,
) -> bytes:
    buffer = io.BytesIO()
    book = xlsxwriter.Workbook(buffer, {"in_memory": True, "remove_timezone": True})
    clinic = letterhead.name_ru or letterhead.name_uz or letterhead.short_name
    book.set_properties(
        {
            "title": export.title,
            "author": author or letterhead.short_name,
            "company": clinic,
            "created": generated_at.replace(tzinfo=None),
            "comments": f"KetoCare · {export.code}",
        }
    )

    header = book.add_format({"bold": True, "text_wrap": True, "valign": "top"})
    formats: dict[ColumnKind, Any] = {
        "text": book.add_format({"valign": "top"}),
        "int": book.add_format({"num_format": "#,##0", "valign": "top"}),
        # Excel покажет разделитель дробной части по локали: «3,4» у русского.
        "decimal": book.add_format({"num_format": "0.0", "valign": "top"}),
        "date": book.add_format({"num_format": "dd.mm.yyyy", "valign": "top"}),
        "bool": book.add_format({"align": "center", "valign": "top"}),
    }

    sheet = book.add_worksheet(export.sheet[:31])
    last_col = len(export.columns) - 1
    for index, column in enumerate(export.columns):
        sheet.set_column(index, index, column.width, formats[column.kind])
    for row_index, row in enumerate(export.rows, start=1):
        for col_index, (column, value) in enumerate(zip(export.columns, row, strict=True)):
            if value is None:
                continue
            if column.kind == "bool":
                sheet.write_string(row_index, col_index, "да" if value else "нет", formats["bool"])
            elif column.kind == "date" and isinstance(value, date):
                sheet.write_datetime(
                    row_index,
                    col_index,
                    datetime(value.year, value.month, value.day),
                    formats["date"],
                )
            elif column.kind in ("int", "decimal"):
                sheet.write_number(row_index, col_index, float(value), formats[column.kind])
            else:
                sheet.write_string(row_index, col_index, str(value), formats["text"])
    # «Умная таблица»: заголовки с фильтром, полосы строк; у пустого списка —
    # одна строка заголовков, Excel не принимает таблицу без строк.
    last_row = max(len(export.rows), 1)
    sheet.add_table(
        0,
        0,
        last_row,
        last_col,
        {
            "name": "Data",
            "style": "Table Style Light 1",
            "columns": [{"header": c.title, "header_format": header} for c in export.columns],
        },
    )
    sheet.freeze_panes(1, 0)

    # Печать: альбомная A4, по ширине одна страница, строка заголовков на
    # каждой странице; бланк клиники — в колонтитулах.
    sheet.set_landscape()
    sheet.set_paper(9)
    sheet.fit_to_pages(1, 0)
    sheet.repeat_rows(0)
    sheet.set_margins(left=0.6, right=0.6, top=0.9, bottom=0.8)
    left = "&L&G " if logo_png else "&L"
    options: dict[str, Any] = {}
    if logo_png:
        options = {
            "image_data_left": io.BytesIO(logo_png),
            "image_left": "logo.png",
            "scale_with_doc": False,
        }
    sheet.set_header(
        f"{left}&9{_header_text(letterhead.short_name)}"
        f"&C&9{_header_text(export.title)}"
        f"&R&9{generated_at:%d.%m.%Y}",
        options,
    )
    sheet.set_footer(
        f"&L&8KetoCare · {_header_text(export.code)}&R&8Стр. &P из &N",
    )

    about = book.add_worksheet("Сведения")
    about.set_column(0, 0, 22)
    about.set_column(1, 1, 80)
    label = book.add_format({"bold": True, "valign": "top"})
    wrap = book.add_format({"text_wrap": True, "valign": "top"})
    lines: list[tuple[str, str]] = [
        ("Документ", export.title),
        ("Клиника", clinic),
        *([("Выгрузил(а)", author)] if author else []),
        ("Когда", f"{generated_at:%d.%m.%Y %H:%M} (Ташкент)"),
        *export.about,
        ("Строк", str(len(export.rows))),
        ("Версия", f"KetoCare, расчёт {engine_version} · {export.code}"),
    ]
    about.write_row(0, 0, ["Сведение", "Значение"], label)
    for index, (key, value) in enumerate(lines, start=1):
        about.write_string(index, 0, key, label)
        about.write_string(index, 1, value, wrap)

    book.close()
    return buffer.getvalue()
