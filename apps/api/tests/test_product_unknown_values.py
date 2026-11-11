"""Прочерк в источнике и отходы (`unknown_fields`, `waste_pct`, ADR-0067, этап 2).

Потребители формы:

- карточка продукта в кабинете (`apps/web/src/features/products/ProductCard.tsx`)
  печатает «нет данных» у поля из `unknown_fields` и «Отходы: N %» по `waste_pct`;
- файл `docs/import/sources/mz-ruz.csv` загружается этим импортом в
  справочник-источник: прочерки — пустыми ячейками, отходы — колонкой `waste_pct`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from core.models import FoodStandard, Product, ProductCategory
from core.models.enums import CarbsConvention, FoodDietType, FoodStandardKind, UserRole
from core.repositories import patients as patients_repo
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


async def _locked_beef(client, session, user, auth_headers) -> Product:
    """Говядина Минздрава с прочерком в углеводах — в закрытом справочнике-источнике."""

    reference = await _standard(session, FoodStandardKind.REFERENCE)
    name = f"Говядина {uuid.uuid4().hex[:6]}"
    await client.post(
        "/api/v1/products/import",
        params={"standard_id": str(reference.id), "dry_run": "false"},
        files=_file(_beef(name)),
        headers=auth_headers(user),
    )
    items, _ = await products_repo.search(session, q=name, standard_id=reference.id)
    reference.locked_at = datetime.now(UTC)
    await session.flush()
    return items[0]


def _derive_body(source: Product, clinic: FoodStandard, **changes) -> dict:
    body = {
        "standard_id": str(clinic.id),
        "name_ru": source.name_ru,
        "category_id": str(source.category_id),
        "kcal_100g": 218,
        "fat_100g": 7,
        "protein_100g": 18.9,
        "carbs_100g": 0,
        "fiber_100g": 0,
        "source": "Правка диетолога",
        "source_version": "2026-11",
        "verified_at": "2026-11-11",
    }
    body.update(changes)
    return body


async def test_copy_with_carbs_left_unknown_is_refused(client, session, make_user, auth_headers):
    """Прочерк в углеводах, оставленный как есть, в стандарт клиники не попадает.

    Форма подставляет 0 на место прочерка; без отказа этот 0 ушёл бы в расчёт
    ребёнку как настоящее число.
    """

    dietitian = await make_user(UserRole.DIETITIAN)
    source = await _locked_beef(client, session, dietitian, auth_headers)
    clinic = await _standard(session, FoodStandardKind.CLINIC)

    response = await client.post(
        f"/api/v1/products/{source.id}/derive",
        json=_derive_body(source, clinic),
        headers=auth_headers(dietitian),
    )

    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["details"]["fields"] == ["carbs_100g"]
    assert "углеводы" in error["message"]


async def test_copy_with_written_carbs_is_clinic_clean(client, session, make_user, auth_headers):
    """Вписанные углеводы — копия заводится; неизвестная клетчатка — `fiber_known=false`."""

    dietitian = await make_user(UserRole.DIETITIAN)
    source = await _locked_beef(client, session, dietitian, auth_headers)
    clinic = await _standard(session, FoodStandardKind.CLINIC)

    response = await client.post(
        f"/api/v1/products/{source.id}/derive",
        json=_derive_body(source, clinic, carbs_100g=0.5),
        headers=auth_headers(dietitian),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["unknown_fields"] == []
    assert body["fiber_known"] is False
    assert body["waste_pct"] == 25.0


async def test_true_zero_is_confirmed_explicitly(client, session, make_user, auth_headers):
    """Настоящий ноль на месте прочерка подтверждается явно (`confirmed_fields`)."""

    dietitian = await make_user(UserRole.DIETITIAN)
    source = await _locked_beef(client, session, dietitian, auth_headers)
    clinic = await _standard(session, FoodStandardKind.CLINIC)

    response = await client.post(
        f"/api/v1/products/{source.id}/derive",
        json=_derive_body(source, clinic, confirmed_fields=["carbs_100g"]),
        headers=auth_headers(dietitian),
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["unknown_fields"] == []
    assert body["value_sources"]["carbs_100g"]["kind"] == "manual"


async def test_edit_confirms_zero_in_a_reference_record(client, session, make_user, auth_headers):
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
            **_derive_body(product, standard),
            "confirmed_fields": ["carbs_100g", "fiber_100g"],
        },
        headers=auth_headers(dietitian),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["unknown_fields"] == []
    assert body["fiber_known"] is True


async def test_repository_keeps_clinic_standard_free_of_unknown_energy(session, make_user):
    """Инвариант держит и репозиторий, а не только ручка."""

    admin = await make_user(UserRole.ADMIN)
    clinic = await _standard(session, FoodStandardKind.CLINIC)
    category = ProductCategory(name_ru=f"Категория {uuid.uuid4().hex[:6]}", sort=0)
    session.add(category)
    await session.flush()
    values = dict(
        name_ru=f"Говядина {uuid.uuid4().hex[:6]}",
        category_id=category.id,
        kcal_100g=218,
        fat_100g=7,
        protein_100g=18.9,
        carbs_100g=0,
        fiber_100g=0,
        source="Минздрав РУз",
        source_version="1",
        verified_at=date(2026, 11, 11),
    )

    with pytest.raises(products_repo.UnknownValueInClinicError):
        await products_repo.create(
            session,
            changed_by=admin.id,
            standard_id=clinic.id,
            unknown_fields=["carbs_100g"],
            **values,
        )

    product = await products_repo.create(
        session,
        changed_by=admin.id,
        standard_id=clinic.id,
        unknown_fields=["fiber_100g"],
        **{**values, "name_ru": values["name_ru"] + " 2"},
    )
    assert product.unknown_fields == []
    assert product.fiber_known is False

    with pytest.raises(products_repo.UnknownValueInClinicError):
        await products_repo.update(
            session, product=product, changed_by=admin.id, unknown_fields=["fat_100g"]
        )


async def test_calculator_refuses_product_with_unknown_energy(
    client, session, make_user, auth_headers
):
    """Значения `/calc` приходят телом, но прочерк — отметка базы: отказ 422."""

    dietitian = await make_user(UserRole.DIETITIAN)
    source = await _locked_beef(client, session, dietitian, auth_headers)
    ingredient = {
        "product_id": str(source.id),
        "kcal": 218,
        "fat": 7,
        "protein": 18.9,
        "carbs": 0,
        "fiber": 0,
    }

    response = await client.post(
        "/api/v1/calc/verify",
        json={
            "ingredients": [ingredient],
            "items": [{"product_id": str(source.id), "grams": 100}],
        },
        headers=auth_headers(dietitian),
    )

    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert source.name_ru in error["message"]
    assert error["details"]["product_ids"] == [str(source.id)]


async def test_dish_with_unknown_energy_product_is_not_saved(
    client, session, make_user, make_patient, auth_headers
):
    dietitian = await make_user(UserRole.DIETITIAN)
    source = await _locked_beef(client, session, dietitian, auth_headers)
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

    response = await client.post(
        f"/api/v1/patients/{patient.id}/custom-dishes",
        json={
            "title": "Обед",
            "ingredients": [{"product_id": str(source.id), "grams": 100}],
        },
        headers=auth_headers(parent),
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"]["product_ids"] == [str(source.id)]
