"""Cooking steps travel with a child's dish and reach the menu (ADR-0088).

A dish fitted from a library recipe used to keep the grams and lose the steps,
so the card printed for a family or a cook said what to weigh and not what to
do with it (dietitian, 17.11.2026).

Consumer: the cabinet (`apps/web`, calculator save and the printed menu).
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from core.models import (
    CustomDish,
    Product,
    ProductCategory,
    Recipe,
    RecipeIngredient,
)
from core.models.enums import RecipeCategory, RecipeStatus, UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

BUTTER = dict(kcal_100g=717, fat_100g=81.1, protein_100g=0.9, carbs_100g=0.1, fiber_100g=0.0)
STEPS = "Отварить курицу.\nОбжарить морковь, добавить курицу."


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


async def _recipe(session, author, product, *, status=RecipeStatus.PUBLISHED) -> Recipe:
    recipe = Recipe(
        title=f"Рецепт {uuid.uuid4().hex[:8]}",
        category=RecipeCategory.DINNER,
        yield_g=100,
        servings=1,
        instructions=f"  {STEPS}  ",
        status=status,
        author_id=author.id,
    )
    session.add(recipe)
    await session.flush()
    session.add(RecipeIngredient(recipe_id=recipe.id, product_id=product.id, grams=30, position=0))
    await session.flush()
    return recipe


async def _setup(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    dietitian = await make_user(UserRole.DIETITIAN)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    await patients_repo.link_doctor(session, doctor_id=dietitian.id, patient_id=patient.id)
    product = await _product(session)
    return parent, dietitian, patient, product


def _dishes(patient) -> str:
    return f"/api/v1/patients/{patient.id}/custom-dishes"


def _body(product, **extra):
    return {
        "title": "Курица с морковью",
        "ingredients": [{"product_id": str(product.id), "grams": 25}],
        **extra,
    }


class TestDishFromRecipe:
    async def test_recipe_steps_are_copied(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, dietitian, patient, product = await _setup(session, make_user, make_patient)
        recipe = await _recipe(session, dietitian, product)

        response = await client.post(
            _dishes(patient),
            json=_body(product, source_recipe_id=str(recipe.id)),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["instructions"] == STEPS
        assert body["source_recipe_id"] == str(recipe.id)

    async def test_sent_steps_win_over_the_recipe(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, dietitian, patient, product = await _setup(session, make_user, make_patient)
        recipe = await _recipe(session, dietitian, product)

        response = await client.post(
            _dishes(patient),
            json=_body(product, source_recipe_id=str(recipe.id), instructions="Своё"),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 201, response.text
        assert response.json()["instructions"] == "Своё"

    async def test_unknown_recipe_is_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, dietitian, patient, product = await _setup(session, make_user, make_patient)

        response = await client.post(
            _dishes(patient),
            json=_body(product, source_recipe_id=str(uuid.uuid4())),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_family_cannot_read_a_draft_through_the_link(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """A draft is hidden from a family (section 5.3); copying its steps
        into the family's dish would show it all the same."""
        parent, dietitian, patient, product = await _setup(session, make_user, make_patient)
        draft = await _recipe(session, dietitian, product, status=RecipeStatus.DRAFT)

        response = await client.post(
            _dishes(patient),
            json=_body(product, source_recipe_id=str(draft.id)),
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    async def test_other_patient_is_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, dietitian, _, product = await _setup(session, make_user, make_patient)
        stranger = await make_patient()
        recipe = await _recipe(session, dietitian, product)

        response = await client.post(
            _dishes(stranger),
            json=_body(product, source_recipe_id=str(recipe.id)),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 403

    async def test_too_long_steps_are_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, dietitian, patient, product = await _setup(session, make_user, make_patient)

        response = await client.post(
            _dishes(patient),
            json=_body(product, instructions="ш" * 10001),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 422


class TestUpdateKeepsSteps:
    async def test_put_without_steps_keeps_them(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Renaming and changing grams send no steps — older clients (the Mini
        App among them) know nothing of them, and must not erase them."""
        _, dietitian, patient, product = await _setup(session, make_user, make_patient)
        created = await client.post(
            _dishes(patient),
            json=_body(product, instructions=STEPS),
            headers=auth_headers(dietitian),
        )
        dish_id = created.json()["id"]

        response = await client.put(
            f"{_dishes(patient)}/{dish_id}",
            json=_body(product, title="Новое название"),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 200, response.text
        assert response.json()["instructions"] == STEPS

    async def test_put_with_steps_replaces_and_blank_clears(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, dietitian, patient, product = await _setup(session, make_user, make_patient)
        created = await client.post(
            _dishes(patient),
            json=_body(product, instructions=STEPS),
            headers=auth_headers(dietitian),
        )
        dish_id = created.json()["id"]

        replaced = await client.put(
            f"{_dishes(patient)}/{dish_id}",
            json=_body(product, instructions="Запечь"),
            headers=auth_headers(dietitian),
        )
        assert replaced.json()["instructions"] == "Запечь"

        cleared = await client.put(
            f"{_dishes(patient)}/{dish_id}",
            json=_body(product, instructions="   "),
            headers=auth_headers(dietitian),
        )
        assert cleared.json()["instructions"] is None

    async def test_put_does_not_change_the_origin(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, dietitian, patient, product = await _setup(session, make_user, make_patient)
        recipe = await _recipe(session, dietitian, product)
        other = await _recipe(session, dietitian, product)
        created = await client.post(
            _dishes(patient),
            json=_body(product, source_recipe_id=str(recipe.id)),
            headers=auth_headers(dietitian),
        )
        dish_id = created.json()["id"]

        response = await client.put(
            f"{_dishes(patient)}/{dish_id}",
            json=_body(product, source_recipe_id=str(other.id)),
            headers=auth_headers(dietitian),
        )
        assert response.json()["source_recipe_id"] == str(recipe.id)


class TestMenuCarriesSteps:
    async def test_menu_items_carry_recipe_and_dish_steps(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """The printed menu reads steps from here (consumer: `WeekPrint`)."""
        parent, dietitian, patient, product = await _setup(session, make_user, make_patient)
        recipe = await _recipe(session, dietitian, product)
        dish = CustomDish(
            patient_id=patient.id,
            title="Своё",
            ingredients=[{"product_id": str(product.id), "grams": 20}],
            instructions="Запечь",
        )
        bare = CustomDish(
            patient_id=patient.id,
            title="Без шагов",
            ingredients=[{"product_id": str(product.id), "grams": 10}],
        )
        session.add_all([dish, bare])
        await session.flush()

        response = await client.put(
            f"/api/v1/patients/{patient.id}/menus",
            json={
                "date": "2026-11-18",
                "items": [
                    {"meal_index": 1, "recipe_id": str(recipe.id)},
                    {"meal_index": 2, "custom_dish_id": str(dish.id)},
                    {"meal_index": 3, "custom_dish_id": str(bare.id)},
                ],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 200, response.text
        steps = {item["meal_index"]: item["instructions"] for item in response.json()["items"]}
        assert steps == {1: STEPS, 2: "Запечь", 3: None}
