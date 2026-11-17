"""«Уже давали» and «взять новый состав» for a child's menu (ADR-0089).

Consumer: the cabinet — dish pickers (`features/menu/useDishUsage.ts`) and the
week cell (`features/menu/WeekCellItem.tsx`).
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from core.models import (
    CustomDish,
    MenuItem,
    Product,
    ProductCategory,
    Recipe,
    RecipeIngredient,
)
from core.models.enums import RecipeCategory, RecipeStatus, UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

BUTTER = dict(kcal_100g=717, fat_100g=81.1, protein_100g=0.9, carbs_100g=0.1, fiber_100g=0.0)


async def _product(session) -> Product:
    category = await session.scalar(select(ProductCategory).limit(1))
    if category is None:
        category = ProductCategory(name_ru="Тестовая", sort=0)
        session.add(category)
        await session.flush()
    product = Product(
        name_ru=f"Масло {uuid.uuid4().hex[:8]}",
        category_id=category.id,
        source="USDA",
        source_version="SR28",
        verified_at=date(2026, 1, 1),
        **BUTTER,
    )
    session.add(product)
    await session.flush()
    return product


async def _recipe(session, author, product) -> Recipe:
    recipe = Recipe(
        title=f"Рецепт {uuid.uuid4().hex[:8]}",
        category=RecipeCategory.DINNER,
        yield_g=100,
        servings=1,
        instructions="Смешать",
        status=RecipeStatus.PUBLISHED,
        author_id=author.id,
    )
    session.add(recipe)
    await session.flush()
    session.add(RecipeIngredient(recipe_id=recipe.id, product_id=product.id, grams=30, position=0))
    await session.flush()
    return recipe


async def _dish(session, patient, product, *, grams=20.0, source=None) -> CustomDish:
    dish = CustomDish(
        patient_id=patient.id,
        title=f"Блюдо {uuid.uuid4().hex[:6]}",
        ingredients=[{"product_id": str(product.id), "grams": grams}],
        source_recipe_id=None if source is None else source.id,
    )
    session.add(dish)
    await session.flush()
    return dish


async def _setup(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    dietitian = await make_user(UserRole.DIETITIAN)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    await patients_repo.link_doctor(session, doctor_id=dietitian.id, patient_id=patient.id)
    return parent, dietitian, patient, await _product(session)


async def _save(client, headers, patient, day, items):
    response = await client.put(
        f"/api/v1/patients/{patient.id}/menus",
        json={"date": day, "items": items},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestDishUsage:
    async def test_counts_days_last_date_and_eaten(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, dietitian, patient, product = await _setup(session, make_user, make_patient)
        recipe = await _recipe(session, dietitian, product)
        fitted = await _dish(session, patient, product, source=recipe)
        other = await _dish(session, patient, product)
        headers = auth_headers(parent)

        first = await _save(
            client,
            headers,
            patient,
            "2026-11-10",
            [
                {"meal_index": 1, "recipe_id": str(recipe.id)},
                {"meal_index": 2, "custom_dish_id": str(fitted.id)},
            ],
        )
        await _save(
            client,
            headers,
            patient,
            "2026-11-12",
            [{"meal_index": 1, "custom_dish_id": str(fitted.id)}],
        )
        await _save(
            client,
            headers,
            patient,
            "2026-11-11",
            [{"meal_index": 3, "custom_dish_id": str(other.id)}],
        )
        eaten_item = next(i for i in first["items"] if i["custom_dish_id"] == str(fitted.id))
        marked = await client.post(
            f"/api/v1/patients/{patient.id}/menus/items/{eaten_item['id']}/eaten",
            json={"eaten": True},
            headers=headers,
        )
        assert marked.status_code == 200, marked.text

        response = await client.get(
            f"/api/v1/patients/{patient.id}/menus/dish-usage", headers=headers
        )
        assert response.status_code == 200, response.text
        body = response.json()
        recipes = {entry["id"]: entry for entry in body["recipes"]}
        dishes = {entry["id"]: entry for entry in body["dishes"]}

        # Рецепт собирает и себя, и блюдо ребёнка, подобранное из него; день
        # 10.11, где стоят оба, считается один раз.
        assert recipes[str(recipe.id)] == {
            "id": str(recipe.id),
            "last_date": "2026-11-12",
            "days": 2,
            "last_eaten": "2026-11-10",
        }
        assert dishes[str(fitted.id)]["days"] == 2
        assert dishes[str(other.id)] == {
            "id": str(other.id),
            "last_date": "2026-11-11",
            "days": 1,
            "last_eaten": None,
        }

    async def test_removed_day_does_not_count(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, _, patient, product = await _setup(session, make_user, make_patient)
        dish = await _dish(session, patient, product)
        headers = auth_headers(parent)
        await _save(
            client,
            headers,
            patient,
            "2026-11-10",
            [{"meal_index": 1, "custom_dish_id": str(dish.id)}],
        )
        removed = await client.delete(
            f"/api/v1/patients/{patient.id}/menus", params={"date": "2026-11-10"}, headers=headers
        )
        assert removed.status_code == 204, removed.text

        response = await client.get(
            f"/api/v1/patients/{patient.id}/menus/dish-usage", headers=headers
        )
        assert response.json() == {"recipes": [], "dishes": []}

    async def test_other_patient_is_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, _, _, _ = await _setup(session, make_user, make_patient)
        stranger = await make_patient()

        response = await client.get(
            f"/api/v1/patients/{stranger.id}/menus/dish-usage", headers=auth_headers(parent)
        )
        assert response.status_code == 403


class TestRefreshItem:
    async def test_takes_the_dish_as_it_is_now_and_recounts_the_day(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, dietitian, patient, product = await _setup(session, make_user, make_patient)
        dish = await _dish(session, patient, product, grams=20)
        headers = auth_headers(dietitian)
        saved = await _save(
            client,
            headers,
            patient,
            "2026-11-20",
            [{"meal_index": 1, "custom_dish_id": str(dish.id)}],
        )
        item_id = saved["items"][0]["id"]
        fat_before = saved["totals"]["fat"]

        dish.ingredients = [{"product_id": str(product.id), "grams": 40}]
        await session.flush()
        stale = await client.get(
            f"/api/v1/patients/{patient.id}/menus", params={"date": "2026-11-20"}, headers=headers
        )
        assert stale.json()["items"][0]["changed_since_saved"] is True

        response = await client.post(
            f"/api/v1/patients/{patient.id}/menus/items/{item_id}/refresh", headers=headers
        )
        assert response.status_code == 200, response.text
        body = response.json()
        item = body["items"][0]
        # Та же позиция — отметки и ссылки дневника на неё сохраняются.
        assert item["id"] == item_id
        assert item["ingredients"][0]["grams"] == 40
        assert item["changed_since_saved"] is False
        assert body["totals"]["fat"] == pytest.approx(fat_before * 2, rel=1e-3)
        assert body["updated_by_role"] == "dietitian"

    async def test_eaten_item_is_not_refreshed(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, _, patient, product = await _setup(session, make_user, make_patient)
        dish = await _dish(session, patient, product)
        headers = auth_headers(parent)
        saved = await _save(
            client,
            headers,
            patient,
            "2026-11-10",
            [{"meal_index": 1, "custom_dish_id": str(dish.id)}],
        )
        item_id = saved["items"][0]["id"]
        await client.post(
            f"/api/v1/patients/{patient.id}/menus/items/{item_id}/eaten",
            json={"eaten": True},
            headers=headers,
        )

        response = await client.post(
            f"/api/v1/patients/{patient.id}/menus/items/{item_id}/refresh", headers=headers
        )
        assert response.status_code == 409
        assert response.json()["error"]["details"]["reason"] == "eaten"

    async def test_item_of_another_patient_is_not_found(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, _, patient, product = await _setup(session, make_user, make_patient)
        other_parent, _, other, other_product = await _setup(session, make_user, make_patient)
        dish = await _dish(session, other, other_product)
        saved = await _save(
            client,
            auth_headers(other_parent),
            other,
            "2026-11-10",
            [{"meal_index": 1, "custom_dish_id": str(dish.id)}],
        )

        response = await client.post(
            f"/api/v1/patients/{patient.id}/menus/items/{saved['items'][0]['id']}/refresh",
            headers=auth_headers(parent),
        )
        assert response.status_code == 404

    async def test_stranger_is_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, _, patient, product = await _setup(session, make_user, make_patient)
        dish = await _dish(session, patient, product)
        saved = await _save(
            client,
            auth_headers(parent),
            patient,
            "2026-11-10",
            [{"meal_index": 1, "custom_dish_id": str(dish.id)}],
        )
        stranger = await make_user(UserRole.PARENT)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/menus/items/{saved['items'][0]['id']}/refresh",
            headers=auth_headers(stranger),
        )
        assert response.status_code == 403

    async def test_deleted_dish_is_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, _, patient, product = await _setup(session, make_user, make_patient)
        dish = await _dish(session, patient, product)
        headers = auth_headers(parent)
        saved = await _save(
            client,
            headers,
            patient,
            "2026-11-10",
            [{"meal_index": 1, "custom_dish_id": str(dish.id)}],
        )
        await client.delete(
            f"/api/v1/patients/{patient.id}/custom-dishes/{dish.id}", headers=headers
        )

        response = await client.post(
            f"/api/v1/patients/{patient.id}/menus/items/{saved['items'][0]['id']}/refresh",
            headers=headers,
        )
        assert response.status_code == 422
        # День не тронут: снимок прежний.
        item = await session.get(MenuItem, uuid.UUID(saved["items"][0]["id"]))
        assert item is not None and item.snapshot is not None
