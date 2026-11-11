"""Прочерк в источнике и отходы (`unknown_fields`, `waste_pct`, ADR-0067, этап 2).

Потребители формы:

- карточка продукта в кабинете (`apps/web/src/features/products/ProductCard.tsx`)
  печатает «нет данных» у поля из `unknown_fields` и «Отходы: N %» по `waste_pct`;
- файл `docs/import/sources/mz-ruz.csv` загружается этим импортом в
  справочник-источник: прочерки — пустыми ячейками, отходы — колонкой `waste_pct`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

from core.models import FoodStandard
from core.models.enums import CarbsConvention, FoodDietType, FoodStandardKind, UserRole
from core.repositories import products as products_repo

pytestmark = pytest.mark.asyncio

HEADER = (
    "name_ru,category,kcal_100g,fat_100g,protein_100g,carbs_100g,fiber_100g,"
    "source,source_version,verified_at,waste_pct"
)


async def _standard(session, kind: FoodStandardKind) -> FoodStandard:
    standard = FoodStandard(
        name=f"Стандарт {uuid.uuid4().hex[:8]}",
        kind=kind,
        diet_type=FoodDietType.GENERAL,
        carbs_convention=CarbsConvention.UNKNOWN,
    )
    session.add(standard)
    await session.flush()
    return standard


def _source_file(name: str) -> bytes:
    return (Path(__file__).resolve().parents[3] / "docs" / "import" / "sources" / name).read_bytes()


def _file(*rows: str) -> dict:
    content = ("\n".join([HEADER, *rows]) + "\n").encode("utf-8")
    return {"file": ("mz.csv", content, "text/csv")}


def _beef(name: str) -> str:
    # Говядина I категории из таблицы Минздрава РУз: прочерк в углеводах,
    # клетчатки в таблице нет, отходы 25 %.
    return f"{name},Белковые,218,7,18.9,,,Минздрав РУз,действующая редакция,2026-11-11,25"


async def test_reference_import_records_unknown_fields_and_waste(
    client, session, make_user, auth_headers
):
    dietitian = await make_user(UserRole.DIETITIAN)
    standard = await _standard(session, FoodStandardKind.REFERENCE)
    name = f"Говядина {uuid.uuid4().hex[:6]}"

    response = await client.post(
        "/api/v1/products/import",
        params={"standard_id": str(standard.id), "dry_run": "false"},
        files=_file(_beef(name)),
        headers=auth_headers(dietitian),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["imported"] == 1, body
    # 7·9 + 18,9·4 = 138,6 против 218 заявленных: углеводы неизвестны, и
    # сверка 9 — 4 — 4 о такой строке ничего не скажет — предупреждения нет.
    assert body["warnings"] == []

    items, _ = await products_repo.search(session, q=name, standard_id=standard.id)
    product = items[0]
    assert sorted(product.unknown_fields) == ["carbs_100g", "fiber_100g"]
    assert float(product.carbs_100g) == 0
    assert float(product.waste_pct) == 25
    assert product.fiber_known is False

    card = await client.get(f"/api/v1/products/{product.id}", headers=auth_headers(dietitian))
    assert card.status_code == 200, card.text
    read = card.json()
    assert sorted(read["unknown_fields"]) == ["carbs_100g", "fiber_100g"]
    assert read["waste_pct"] == 25.0


async def test_clinic_standard_rejects_empty_value(client, session, make_user, auth_headers):
    """В рабочем справочнике пустая ячейка — ошибка строки, а не ноль."""

    dietitian = await make_user(UserRole.DIETITIAN)
    standard = await _standard(session, FoodStandardKind.CLINIC)

    response = await client.post(
        "/api/v1/products/import",
        params={"standard_id": str(standard.id)},
        files=_file(_beef(f"Говядина {uuid.uuid4().hex[:6]}")),
        headers=auth_headers(dietitian),
    )

    assert response.status_code == 200, response.text
    errors = response.json()["errors"]
    assert {error["column"] for error in errors} == {"carbs_100g", "fiber_100g"}
    assert all("справочнике-источнике" in error["message"] for error in errors)


async def test_waste_out_of_range_is_a_row_error(client, session, make_user, auth_headers):
    admin = await make_user(UserRole.ADMIN)
    standard = await _standard(session, FoodStandardKind.REFERENCE)
    row = _beef(f"Говядина {uuid.uuid4().hex[:6]}").rsplit(",", 1)[0] + ",100"

    response = await client.post(
        "/api/v1/products/import",
        params={"standard_id": str(standard.id)},
        files=_file(row),
        headers=auth_headers(admin),
    )

    errors = response.json()["errors"]
    assert [error["column"] for error in errors] == ["waste_pct"]


async def test_kcal_check_still_warns_when_all_energy_fields_known(
    client, session, make_user, auth_headers
):
    """Неизвестна только клетчатка — 9 — 4 — 4 считается как обычно."""

    admin = await make_user(UserRole.ADMIN)
    standard = await _standard(session, FoodStandardKind.REFERENCE)
    row = (
        f"Сыр {uuid.uuid4().hex[:6]},Молочные,380,30,21,2.5,,"
        "Минздрав РУз,действующая редакция,2026-11-11,"
    )

    response = await client.post(
        "/api/v1/products/import",
        params={"standard_id": str(standard.id)},
        files=_file(row),
        headers=auth_headers(admin),
    )

    body = response.json()
    assert body["errors"] == []
    assert [warning["kind"] for warning in body["warnings"]] == ["kcal_mismatch"]


async def test_family_cannot_import(client, session, make_user, auth_headers):
    parent = await make_user(UserRole.PARENT)
    standard = await _standard(session, FoodStandardKind.REFERENCE)

    response = await client.post(
        "/api/v1/products/import",
        params={"standard_id": str(standard.id)},
        files=_file(_beef(f"Говядина {uuid.uuid4().hex[:6]}")),
        headers=auth_headers(parent),
    )

    assert response.status_code == 403, response.text


async def test_manual_edit_clears_unknown_for_the_written_field(
    client, session, make_user, auth_headers
):
    """Вписанное диетологом число перестаёт быть «нет данных»; прочие — нет."""

    dietitian = await make_user(UserRole.DIETITIAN)
    standard = await _standard(session, FoodStandardKind.REFERENCE)
    name = f"Говядина {uuid.uuid4().hex[:6]}"
    await client.post(
        "/api/v1/products/import",
        params={"standard_id": str(standard.id), "dry_run": "false"},
        files=_file(_beef(name)),
        headers=auth_headers(dietitian),
    )
    items, _ = await products_repo.search(session, q=name, standard_id=standard.id)
    product = items[0]

    response = await client.put(
        f"/api/v1/products/{product.id}",
        json={
            "name_ru": product.name_ru,
            "category_id": str(product.category_id),
            "kcal_100g": 218,
            "fat_100g": 7,
            "protein_100g": 18.9,
            "carbs_100g": 0.5,
            "fiber_100g": 0,
            "source": "Правка диетолога",
            "source_version": "2026-11",
            "verified_at": "2026-11-11",
        },
        headers=auth_headers(dietitian),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["unknown_fields"] == ["fiber_100g"]
    assert body["waste_pct"] == 25.0


async def test_anomaly_list_skips_kcal_check_for_unknown_energy(
    client, session, make_user, auth_headers
):
    admin = await make_user(UserRole.ADMIN)
    standard = await _standard(session, FoodStandardKind.REFERENCE)
    name = f"Говядина {uuid.uuid4().hex[:6]}"
    await client.post(
        "/api/v1/products/import",
        params={"standard_id": str(standard.id), "dry_run": "false"},
        files=_file(_beef(name)),
        headers=auth_headers(admin),
    )

    response = await client.get(
        "/api/v1/products/anomalies", params={"limit": 200}, headers=auth_headers(admin)
    )

    assert response.status_code == 200, response.text
    assert name not in {item["name_ru"] for item in response.json()["items"]}


async def test_source_files_load_and_link_by_name(client, session, make_user, auth_headers):
    """Оба файла `docs/import/sources` загружаются, и одноимённые продукты связаны.

    Слияние (этап 3) соберёт строку рабочего справочника по `food_id`: печень
    Минздрава без углеводов получит их из записи USDA того же продукта.
    """

    admin = await make_user(UserRole.ADMIN)
    standards = {}
    for name in ("mz-ruz.csv", "usda-sr-legacy.csv"):
        standard = await _standard(session, FoodStandardKind.REFERENCE)
        response = await client.post(
            "/api/v1/products/import",
            params={"standard_id": str(standard.id), "dry_run": "false"},
            files={"file": (name, _source_file(name), "text/csv")},
            headers=auth_headers(admin),
        )
        assert response.status_code == 200, response.text
        assert response.json()["errors"] == [], response.json()["errors"][:3]
        standards[name] = standard

    mz, _ = await products_repo.search(
        session, q="Печень говяжья", standard_id=standards["mz-ruz.csv"].id
    )
    usda, _ = await products_repo.search(
        session, q="Печень говяжья", standard_id=standards["usda-sr-legacy.csv"].id
    )
    assert mz[0].food_id == usda[0].food_id
    assert "carbs_100g" in mz[0].unknown_fields
    assert float(usda[0].carbs_100g) == 3.89


async def test_derived_copy_keeps_unknown_until_a_number_is_written(
    client, session, make_user, auth_headers
):
    """«Скорректировать»: прочерк источника остаётся прочерком, вписанное — нет."""

    dietitian = await make_user(UserRole.DIETITIAN)
    reference = await _standard(session, FoodStandardKind.REFERENCE)
    clinic = await _standard(session, FoodStandardKind.CLINIC)
    name = f"Говядина {uuid.uuid4().hex[:6]}"
    await client.post(
        "/api/v1/products/import",
        params={"standard_id": str(reference.id), "dry_run": "false"},
        files=_file(_beef(name)),
        headers=auth_headers(dietitian),
    )
    items, _ = await products_repo.search(session, q=name, standard_id=reference.id)
    source = items[0]
    reference.locked_at = datetime.now(UTC)
    await session.flush()

    response = await client.post(
        f"/api/v1/products/{source.id}/derive",
        json={
            "standard_id": str(clinic.id),
            "name_ru": name,
            "category_id": str(source.category_id),
            "kcal_100g": 218,
            "fat_100g": 7,
            "protein_100g": 18.9,
            "carbs_100g": 0.5,
            "fiber_100g": 0,
            "source": "Правка диетолога",
            "source_version": "2026-11",
            "verified_at": "2026-11-11",
        },
        headers=auth_headers(dietitian),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["unknown_fields"] == ["fiber_100g"]
    assert body["waste_pct"] == 25.0
