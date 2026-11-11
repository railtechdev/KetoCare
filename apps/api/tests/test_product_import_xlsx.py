"""Импорт продуктов из Excel: тот же разбор, что у CSV (ADR-0064)."""

from __future__ import annotations

import io
from datetime import datetime

import pytest
from openpyxl import Workbook

from api.services import spreadsheet
from core.models.enums import UserRole

HEADER = [
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
]


def _book(*rows: list[object]) -> bytes:
    book = Workbook()
    sheet = book.active
    assert sheet is not None
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def test_first_sheet_becomes_csv_with_iso_dates_and_plain_numbers():
    content = _book(
        HEADER,
        ["Масло", "Жиры", 717.0, 81.1, 0.9, 0.1, 0, "USDA", "SR28", datetime(2026, 1, 1)],
        [],
    )

    assert spreadsheet.is_xlsx(content)
    text = spreadsheet.xlsx_to_csv(content).decode("utf-8")
    assert text.splitlines()[1] == "Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01"
    assert len(text.splitlines()) == 2


def test_broken_zip_is_a_clear_error():
    with pytest.raises(spreadsheet.SpreadsheetError):
        spreadsheet.xlsx_to_csv(b"PK\x03\x04garbage")


def test_csv_is_not_taken_for_excel():
    assert not spreadsheet.is_xlsx(b"name_ru,category\n")


async def test_an_excel_file_is_previewed(client, make_user, auth_headers):
    admin = await make_user(UserRole.ADMIN)
    content = _book(
        HEADER,
        ["Масло", "Жиры", 717, 81.1, 0.9, 0.1, 0, "USDA", "SR28", "2026-01-01"],
    )

    response = await client.post(
        "/api/v1/products/import",
        files={"file": ("products.xlsx", content, "application/octet-stream")},
        headers=auth_headers(admin),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["errors"] == [], body
