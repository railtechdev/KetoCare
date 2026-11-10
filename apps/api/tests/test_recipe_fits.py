"""`/patients/{id}/recipe-fits`. Reader: «Из библиотеки» in the patient card."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from core.models import Product, ProductCategory
from core.models.enums import RecipeCategory, RecipeStatus, UserRole
from core.repositories import patients as patients_repo
from core.repositories import prescriptions as prescriptions_repo
from core.repositories import recipes as recipes_repo

pytestmark = pytest.mark.asyncio

BUTTER = dict(kcal_100g=717, fat_100g=81.1, protein_100g=0.9, carbs_100g=0.1, fiber_100g=0)
CHICKEN = dict(kcal_100g=165, fat_100g=3.6, protein_100g=31, carbs_100g=0, fiber_100g=0)
BROCCOLI = dict(kcal_100g=34, fat_100g=0.4, protein_100g=2.8, carbs_100g=6.6, fiber_100g=2.6)


async def _product(session, name: str, **macros) -> Product:
    category = await session.scalar(select(ProductCategory).limit(1))
    if category is None:
        category = ProductCategory(name_ru="Тестовая", sort=0)
        session.add(category)
        await session.flush()
    product = Product(
        name_ru=f"{name} {uuid.uuid4().hex[:8]}",
        category_id=category.id,
        source="USDA",
        source_version="SR28",
        verified_at=date(2026, 1, 1),
        **macros,
    )
    session.add(product)
    await session.flush()
    return product


async def _recipe(session, author, parts, *, published=True, title="Курица с брокколи"):
    recipe = await recipes_repo.create(
        session,
        title=title,
        category=RecipeCategory(next(iter(RecipeCategory)).value),
        photo_path=None,
        yield_g=100,
        servings=1,
        instructions="",
        author_id=author.id,
        ingredients=[(product.id, grams) for product, grams in parts],
        computed=None,
        engine_version=None,
    )
    if published:
        recipe.status = RecipeStatus.PUBLISHED
        await session.flush()
    return recipe


@pytest.fixture
async def world(session, make_user, make_patient):
    doctor = await make_user(role=UserRole.DOCTOR)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    await prescriptions_repo.create(
        session,
        patient_id=patient.id,
        ratio=3.5,
        kcal_per_day=1200,
        protein_g=24.0,
        carbs_limit_g=20.0,
        meals_per_day=4,
        author_id=doctor.id,
        effective_from=date.today(),
    )
    return doctor, patient


def _url(patient) -> str:
    return f"/api/v1/patients/{patient.id}/recipe-fits"


async def test_recipe_is_fitted_to_the_meal_target(client, session, auth_headers, world):
    doctor, patient = world
    butter = await _product(session, "Масло", **BUTTER)
    chicken = await _product(session, "Курица", **CHICKEN)
    broccoli = await _product(session, "Брокколи", **BROCCOLI)
    recipe = await _recipe(session, doctor, [(chicken, 50), (butter, 40), (broccoli, 30)])

    response = await client.post(
        _url(patient), json={"recipe_ids": [str(recipe.id)]}, headers=auth_headers(doctor)
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["target_ratio"] == 3.5
    assert body["target_kcal"] == 300
    fit = body["items"][0]
    assert fit["status"] == "fitted"
    assert fit["ratio_within_tolerance"] is True
    assert fit["kcal_within_tolerance"] is True
    assert {item["product_id"] for item in fit["ingredients"]} == {
        str(butter.id),
        str(chicken.id),
        str(broccoli.id),
    }
    assert all(item["grams"] >= 2 for item in fit["ingredients"])


async def test_nothing_is_saved_to_the_child(client, session, auth_headers, world):
    doctor, patient = world
    butter = await _product(session, "Масло", **BUTTER)
    chicken = await _product(session, "Курица", **CHICKEN)
    recipe = await _recipe(session, doctor, [(chicken, 50), (butter, 40)])

    await client.post(
        _url(patient), json={"recipe_ids": [str(recipe.id)]}, headers=auth_headers(doctor)
    )

    listed = await client.get(
        f"/api/v1/patients/{patient.id}/custom-dishes", headers=auth_headers(doctor)
    )
    assert listed.json()["total"] == 0


async def test_excluded_product_is_named_and_not_solved(client, session, auth_headers, world):
    doctor, patient = world
    butter = await _product(session, "Масло", **BUTTER)
    chicken = await _product(session, "Курица", **CHICKEN)
    patient.allergies = [str(chicken.id)]
    await session.flush()
    recipe = await _recipe(session, doctor, [(chicken, 50), (butter, 40)])

    response = await client.post(
        _url(patient), json={"recipe_ids": [str(recipe.id)]}, headers=auth_headers(doctor)
    )

    fit = response.json()["items"][0]
    assert fit["status"] == "excluded"
    assert chicken.name_ru in fit["reason"]
    assert fit["ingredients"] == []


async def test_draft_recipe_is_not_fitted(client, session, auth_headers, world):
    doctor, patient = world
    butter = await _product(session, "Масло", **BUTTER)
    recipe = await _recipe(session, doctor, [(butter, 40)], published=False)

    response = await client.post(
        _url(patient), json={"recipe_ids": [str(recipe.id)]}, headers=auth_headers(doctor)
    )

    assert response.json()["items"][0]["status"] == "unavailable"


async def test_unreachable_target_gives_a_reason(client, session, auth_headers, world):
    doctor, patient = world
    chicken = await _product(session, "Курица", **CHICKEN)
    recipe = await _recipe(session, doctor, [(chicken, 50)])

    response = await client.post(
        _url(patient), json={"recipe_ids": [str(recipe.id)]}, headers=auth_headers(doctor)
    )

    fit = response.json()["items"][0]
    assert fit["status"] == "infeasible"
    assert fit["reason"]


async def test_withdrawn_product_is_reported(client, session, auth_headers, world):
    doctor, patient = world
    butter = await _product(session, "Масло", **BUTTER)
    chicken = await _product(session, "Курица", **CHICKEN)
    chicken.is_active = False
    await session.flush()
    recipe = await _recipe(session, doctor, [(chicken, 50), (butter, 40)])

    response = await client.post(
        _url(patient), json={"recipe_ids": [str(recipe.id)]}, headers=auth_headers(doctor)
    )

    assert response.json()["items"][0]["withdrawn"] == [chicken.name_ru]


async def test_no_prescription_is_a_conflict(
    client, session, auth_headers, make_user, make_patient
):
    doctor = await make_user(role=UserRole.DOCTOR)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

    response = await client.post(
        _url(patient), json={"recipe_ids": [str(uuid.uuid4())]}, headers=auth_headers(doctor)
    )

    assert response.status_code == 409


async def test_family_is_refused(client, session, auth_headers, make_user, world):
    _, patient = world
    parent = await make_user(role=UserRole.PARENT)
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

    response = await client.post(
        _url(patient), json={"recipe_ids": [str(uuid.uuid4())]}, headers=auth_headers(parent)
    )

    assert response.status_code == 403


async def test_another_doctors_patient_is_refused(client, auth_headers, make_user, world):
    _, patient = world
    stranger = await make_user(role=UserRole.DOCTOR)

    response = await client.post(
        _url(patient), json={"recipe_ids": [str(uuid.uuid4())]}, headers=auth_headers(stranger)
    )

    assert response.status_code == 403


async def test_empty_list_is_rejected(client, auth_headers, world):
    doctor, patient = world

    response = await client.post(
        _url(patient), json={"recipe_ids": []}, headers=auth_headers(doctor)
    )

    assert response.status_code == 422


def _review_url(patient) -> str:
    return f"/api/v1/patients/{patient.id}/custom-dish-review"


async def _dish(client, doctor_headers, patient, parts, title="Блюдо"):
    response = await client.post(
        f"/api/v1/patients/{patient.id}/custom-dishes",
        json={
            "title": title,
            "ingredients": [
                {"product_id": str(product.id), "grams": grams} for product, grams in parts
            ],
        },
        headers=doctor_headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


class TestDishReview:
    """Reader: the child's dishes and the prescription screen."""

    async def test_dish_off_target_is_listed(self, client, session, auth_headers, world):
        doctor, patient = world
        butter = await _product(session, "Масло", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        dish = await _dish(client, auth_headers(doctor), patient, [(chicken, 100), (butter, 5)])

        response = await client.get(_review_url(patient), headers=auth_headers(doctor))

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["target_ratio"] == 3.5
        assert body["target_kcal"] == 300
        assert body["checked"] == 1
        assert [item["dish_id"] for item in body["off_target"]] == [dish["id"]]
        assert body["off_target"][0]["ratio_within_tolerance"] is False

    async def test_fitted_dish_is_not_listed(self, client, session, auth_headers, world):
        doctor, patient = world
        butter = await _product(session, "Масло", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        recipe = await _recipe(session, doctor, [(chicken, 50), (butter, 40)])
        fitted = await client.post(
            _url(patient), json={"recipe_ids": [str(recipe.id)]}, headers=auth_headers(doctor)
        )
        grams = {
            item["product_id"]: item["grams"] for item in fitted.json()["items"][0]["ingredients"]
        }
        await _dish(
            client,
            auth_headers(doctor),
            patient,
            [(chicken, grams[str(chicken.id)]), (butter, grams[str(butter.id)])],
        )

        response = await client.get(_review_url(patient), headers=auth_headers(doctor))

        assert response.json()["checked"] == 1
        assert response.json()["off_target"] == []

    async def test_new_prescription_changes_the_verdict(self, client, session, auth_headers, world):
        doctor, patient = world
        butter = await _product(session, "Масло", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        recipe = await _recipe(session, doctor, [(chicken, 50), (butter, 40)])
        fitted = await client.post(
            _url(patient), json={"recipe_ids": [str(recipe.id)]}, headers=auth_headers(doctor)
        )
        grams = {
            item["product_id"]: item["grams"] for item in fitted.json()["items"][0]["ingredients"]
        }
        await _dish(
            client,
            auth_headers(doctor),
            patient,
            [(chicken, grams[str(chicken.id)]), (butter, grams[str(butter.id)])],
        )
        await prescriptions_repo.create(
            session,
            patient_id=patient.id,
            ratio=2.0,
            kcal_per_day=1200,
            protein_g=24.0,
            carbs_limit_g=20.0,
            meals_per_day=4,
            author_id=doctor.id,
            effective_from=date.today(),
        )

        response = await client.get(_review_url(patient), headers=auth_headers(doctor))

        assert response.json()["target_ratio"] == 2.0
        assert len(response.json()["off_target"]) == 1

    async def test_no_prescription_has_no_targets(
        self, client, session, auth_headers, make_user, make_patient
    ):
        doctor = await make_user(role=UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.get(_review_url(patient), headers=auth_headers(doctor))

        assert response.status_code == 200
        assert response.json()["target_ratio"] is None
        assert response.json()["off_target"] == []

    async def test_family_is_refused(self, client, session, auth_headers, make_user, world):
        _, patient = world
        parent = await make_user(role=UserRole.PARENT)
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        response = await client.get(_review_url(patient), headers=auth_headers(parent))

        assert response.status_code == 403

    async def test_another_doctors_patient_is_refused(self, client, auth_headers, make_user, world):
        _, patient = world
        stranger = await make_user(role=UserRole.DOCTOR)

        response = await client.get(_review_url(patient), headers=auth_headers(stranger))

        assert response.status_code == 403
