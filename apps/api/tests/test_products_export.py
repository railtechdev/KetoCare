"""`GET /products/export` — the product catalogue in Excel (ADR-0092).

The data sheet stays a table: headers on row 1, an Excel table with a filter, no
merged cells; what was exported and by whom goes to the «Сведения» sheet.
"""

from __future__ import annotations

import io
import uuid
from datetime import date, datetime

import openpyxl
import pytest
from sqlalchemy import select

from core import letterhead
from core.letterhead import LetterheadText
from core.models import AuditLog, ProductCategory
from core.models.enums import UserRole

pytestmark = pytest.mark.asyncio

URL = "/api/v1/products/export"


async def _category(session, name: str, sort: int) -> ProductCategory:
    category = ProductCategory(name_ru=f"{name} {uuid.uuid4().hex[:6]}", sort=sort)
    session.add(category)
    await session.flush()
    return category


async def _product(client, headers, category, name: str, **values) -> dict:
    payload = {
        "name_ru": f"{name} {uuid.uuid4().hex[:6]}",
        "category_id": str(category.id),
        "kcal_100g": 717,
        "fat_100g": 81.1,
        "protein_100g": 0.9,
        "carbs_100g": 0.1,
        "fiber_100g": 0.0,
        "source": "USDA",
        "source_version": "SR28",
        "verified_at": "2026-01-15",
        **values,
    }
    response = await client.post("/api/v1/products", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _book(response) -> openpyxl.Workbook:
    assert response.status_code == 200, response.text
    return openpyxl.load_workbook(io.BytesIO(response.content))


@pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN, UserRole.ADMIN])
async def test_staff_export(client, make_user, auth_headers, role):
    response = await client.get(URL, headers=auth_headers(await make_user(role)))

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "filename*=UTF-8''" in response.headers["content-disposition"]


async def test_family_cannot_export(client, make_user, auth_headers):
    response = await client.get(URL, headers=auth_headers(await make_user(UserRole.PARENT)))

    assert response.status_code == 403


async def test_data_sheet_is_a_table_with_typed_cells(client, session, make_user, auth_headers):
    dietitian = await make_user(UserRole.DIETITIAN)
    headers = auth_headers(dietitian)
    fats = await _category(session, "Жиры", sort=-100)
    dairy = await _category(session, "Молочные", sort=-99)
    butter = await _product(client, headers, fats, "Масло")
    cream = await _product(
        client,
        headers,
        dairy,
        "Сливки",
        kcal_100g=322,
        fat_100g=33.0,
        protein_100g=2.2,
        carbs_100g=3.0,
        fiber_100g=0.0,
    )

    book = _book(await client.get(f"{URL}?q=", headers=headers))

    assert book.sheetnames == ["Продукты", "Сведения"]
    sheet = book["Продукты"]
    assert [cell.value for cell in sheet[1]][:3] == ["Категория", "Продукт", "Ккал"]
    # Excel table with a filter on the header row, header frozen.
    assert "Data" in sheet.tables
    assert sheet.tables["Data"].ref.startswith("A1:")
    assert sheet.freeze_panes == "A2"
    assert not sheet.merged_cells.ranges
    rows = {row[1].value: row for row in sheet.iter_rows(min_row=2)}
    butter_row = rows[butter["name_ru"]]
    assert butter_row[2].value == 717
    assert isinstance(butter_row[3].value, float) and butter_row[3].value == pytest.approx(81.1)
    assert butter_row[8].value == "да"
    assert isinstance(butter_row[12].value, datetime)
    assert butter_row[12].value.date() == date(2026, 1, 15)
    assert butter_row[12].number_format == "dd.mm.yyyy"
    # Ordered by category, then by name: the fats category sorts first.
    names = [row[1].value for row in sheet.iter_rows(min_row=2)]
    assert names.index(butter["name_ru"]) < names.index(cream["name_ru"])


async def test_about_sheet_and_print_setup(client, session, make_user, auth_headers):
    admin = await make_user(UserRole.ADMIN)
    await letterhead.save_text(
        session,
        LetterheadText(
            name_uz="«Namuna» markazi",
            name_ru="Детский центр «Образец»",
            short_name="ДНЦ «Образец» & Ко",
        ),
        by=admin.id,
    )
    category = await _category(session, "Жиры", sort=0)
    dietitian = await make_user(UserRole.DIETITIAN)

    book = _book(
        await client.get(
            f"{URL}?category_id={category.id}&q=Масло", headers=auth_headers(dietitian)
        )
    )

    about = {row[0].value: row[1].value for row in book["Сведения"].iter_rows(min_row=2)}
    assert about["Документ"] == "Справочник продуктов"
    assert about["Клиника"] == "Детский центр «Образец»"
    assert about["Выгрузил(а)"] == f"{dietitian.full_name}, диетолог"
    assert "категория — " in about["Отбор"] and "поиск — «Масло»" in about["Отбор"]
    assert about["Строк"] == "0"
    assert "KC-LIST-PRODUCTS-1" in about["Версия"]
    sheet = book["Продукты"]
    # «&» in a header is a control character and is doubled.
    assert "ДНЦ «Образец» && Ко" in sheet.oddHeader.left.text
    assert "Стр. &P из &N" in sheet.oddFooter.right.text
    assert sheet.print_title_rows == "$1:$1"
    assert sheet.page_setup.orientation == "landscape"
    assert book.properties.title == "Справочник продуктов"


async def test_unknown_values_are_empty_cells_not_zeros(client, session, make_user, auth_headers):
    """«Нет данных» в источнике (ADR-0067) — пустая ячейка: ноль был бы утверждением."""

    from core.models import Product

    dietitian = await make_user(UserRole.DIETITIAN)
    headers = auth_headers(dietitian)
    category = await _category(session, "Овощи", sort=0)
    created = await _product(
        client,
        headers,
        category,
        "Шпинат",
        kcal_100g=22,
        fat_100g=0.3,
        protein_100g=2.9,
        carbs_100g=3.6,
        fiber_100g=0.0,
    )
    product = await session.get(Product, uuid.UUID(created["id"]))
    product.unknown_fields = ["fiber_100g"]
    await session.flush()

    book = _book(await client.get(f"{URL}?category_id={category.id}", headers=headers))

    row = next(book["Продукты"].iter_rows(min_row=2))
    assert row[1].value == created["name_ru"]
    assert row[6].value is None
    assert row[5].value == pytest.approx(3.6)


async def test_export_is_audited(client, session, make_user, auth_headers):
    doctor = await make_user(UserRole.DOCTOR)

    await client.get(f"{URL}?q=Масло", headers=auth_headers(doctor))

    entry = await session.scalar(
        select(AuditLog).where(
            AuditLog.user_id == doctor.id,
            AuditLog.entity == "products",
            AuditLog.action == "export",
        )
    )
    assert entry is not None
    assert entry.after["format"] == "xlsx"
    assert "поиск — «Масло»" in entry.after["filters"]


async def test_logo_goes_into_the_print_header(client, session, make_user, auth_headers):
    import struct
    import zlib

    def png(width: int, height: int) -> bytes:
        def chunk(kind: bytes, data: bytes) -> bytes:
            body = kind + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

        raw = b"".join(b"\x00" + b"\xff" * width for _ in range(height))
        ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
        return (
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b"")
        )

    admin = await make_user(UserRole.ADMIN)
    await letterhead.save_logo(session, png(400, 200), by=admin.id)

    response = await client.get(URL, headers=auth_headers(admin))

    book = _book(response)
    assert "&G" in book["Продукты"].oddHeader.left.text
