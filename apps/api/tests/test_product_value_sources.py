"""Происхождение отдельных чисел продукта (`value_sources`, ADR-0067, этап 1).

Потребитель формы — карточка продукта в кабинете
(`apps/web/src/features/products/ProductCard.tsx`): рядом с каждым числом она
печатает `label` — название стандарта или «правка: имя, дата».
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest

from core.models import DEFAULT_FOOD_STANDARD_ID, FoodStandard, Product, ProductCategory
from core.models.enums import CarbsConvention, FoodDietType, FoodStandardKind, UserRole

pytestmark = pytest.mark.asyncio

_FIELDS = {"kcal_100g", "fat_100g", "protein_100g", "carbs_100g", "fiber_100g"}


async def _locked_standard(session) -> FoodStandard:
    standard = FoodStandard(
        name=f"Стандарт {uuid.uuid4().hex[:8]}",
        kind=FoodStandardKind.REFERENCE,
        diet_type=FoodDietType.GENERAL,
        carbs_convention=CarbsConvention.TOTAL,
        locked_at=datetime.now(UTC),
    )
    session.add(standard)
    await session.flush()
    return standard


async def _product(session, standard_id) -> Product:
    category = ProductCategory(name_ru=f"Категория {uuid.uuid4().hex[:8]}", sort=0)
    session.add(category)
    await session.flush()
    product = Product(
        name_ru=f"Масло {uuid.uuid4().hex[:6]}",
        standard_id=standard_id,
        category_id=category.id,
        kcal_100g=748,
        fat_100g=82.5,
        protein_100g=0.5,
        carbs_100g=0.8,
        fiber_100g=0,
        source="Документ",
        source_version="2025",
        verified_at=date(2026, 1, 1),
    )
    session.add(product)
    await session.flush()
    return product


def _body(product: Product, **changes) -> dict:
    body = {
        "name_ru": product.name_ru,
        "category_id": str(product.category_id),
        "kcal_100g": float(product.kcal_100g),
        "fat_100g": float(product.fat_100g),
        "protein_100g": float(product.protein_100g),
        "carbs_100g": float(product.carbs_100g),
        "fiber_100g": float(product.fiber_100g),
        "source": product.source,
        "source_version": product.source_version,
        "verified_at": str(product.verified_at),
    }
    body.update(changes)
    return body


async def test_derive_marks_kept_values_by_source_and_changed_by_author(
    client, session, make_user, auth_headers
):
    dietitian = await make_user(UserRole.DIETITIAN)
    locked = await _locked_standard(session)
    original = await _product(session, locked.id)

    response = await client.post(
        f"/api/v1/products/{original.id}/derive",
        json=_body(original, fat_100g=80, kcal_100g=730, source="Своя сверка"),
        headers=auth_headers(dietitian),
    )

    assert response.status_code == 201, response.text
    sources = response.json()["value_sources"]
    assert set(sources) == _FIELDS
    for field in ("protein_100g", "carbs_100g", "fiber_100g"):
        assert sources[field] == {
            "kind": "product",
            "product_id": str(original.id),
            "user_id": None,
            "at": None,
            "label": locked.name,
        }
    for field in ("fat_100g", "kcal_100g"):
        assert sources[field]["kind"] == "manual"
        assert sources[field]["user_id"] == str(dietitian.id)
        assert sources[field]["label"] == dietitian.full_name
        assert sources[field]["at"] is not None

    # Карточка отдаёт то же самое.
    card = await client.get(
        f"/api/v1/products/{response.json()['id']}", headers=auth_headers(dietitian)
    )
    assert card.json()["value_sources"] == sources


async def test_edit_marks_only_changed_values(client, session, make_user, auth_headers):
    admin = await make_user(UserRole.ADMIN)
    product = await _product(session, DEFAULT_FOOD_STANDARD_ID)

    response = await client.put(
        f"/api/v1/products/{product.id}",
        json=_body(product, protein_100g=0.7, source="Своя сверка"),
        headers=auth_headers(admin),
    )

    assert response.status_code == 200, response.text
    sources = response.json()["value_sources"]
    assert set(sources) == {"protein_100g"}
    assert sources["protein_100g"]["kind"] == "manual"
    assert sources["protein_100g"]["label"] == admin.full_name


async def test_untouched_rows_have_no_marks(client, session, make_user, auth_headers):
    doctor = await make_user(UserRole.DOCTOR)
    product = await _product(session, DEFAULT_FOOD_STANDARD_ID)

    response = await client.get(f"/api/v1/products/{product.id}", headers=auth_headers(doctor))

    assert response.status_code == 200
    assert response.json()["value_sources"] == {}


async def test_family_does_not_see_origin(client, session, make_user, auth_headers):
    admin = await make_user(UserRole.ADMIN)
    parent = await make_user(UserRole.PARENT)
    product = await _product(session, DEFAULT_FOOD_STANDARD_ID)
    await client.put(
        f"/api/v1/products/{product.id}",
        json=_body(product, protein_100g=0.7, source="Своя сверка"),
        headers=auth_headers(admin),
    )

    response = await client.get(f"/api/v1/products/{product.id}", headers=auth_headers(parent))

    assert response.status_code == 200
    assert response.json()["value_sources"] == {}


async def test_family_cannot_derive(client, session, make_user, auth_headers):
    parent = await make_user(UserRole.PARENT)
    original = await _product(session, (await _locked_standard(session)).id)

    response = await client.post(
        f"/api/v1/products/{original.id}/derive",
        json=_body(original),
        headers=auth_headers(parent),
    )

    assert response.status_code == 403


async def test_edit_under_old_source_is_rejected_and_leaves_no_mark(
    client, session, make_user, auth_headers
):
    admin = await make_user(UserRole.ADMIN)
    product = await _product(session, DEFAULT_FOOD_STANDARD_ID)

    response = await client.put(
        f"/api/v1/products/{product.id}",
        json=_body(product, protein_100g=0.7),
        headers=auth_headers(admin),
    )

    assert response.status_code == 422
    await session.refresh(product)
    assert product.value_sources == {}
