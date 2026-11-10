"""The 2025 kindergarten documents as a locked `general` standard (ADR-0060)."""

from __future__ import annotations

import csv
import uuid
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import func, select

from api.services import standard_documents
from core.models import (
    DEFAULT_FOOD_STANDARD_ID,
    AuditLog,
    MenuTemplate,
    Product,
    ProductCategory,
    Recipe,
)
from core.models.enums import FoodDietType, RecipeStatus, UserRole
from core.repositories import food_standards as food_standards_repo
from core.repositories import patients as patients_repo
from core.repositories import prescriptions as prescriptions_repo

pytestmark = pytest.mark.asyncio

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "infra" / "seed" / "dmtt-2025"


def _rows(name: str) -> list[dict[str, str]]:
    with (DATA / name).open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


async def _catalogue(session) -> None:
    """Whatever the mapping names, so the test does not depend on a seeded database."""

    category = await session.scalar(select(ProductCategory).limit(1))
    if category is None:
        category = ProductCategory(name_ru="Тестовая", sort=0)
        session.add(category)
        await session.flush()
    for name in {row["catalog_name_ru"] for row in _rows("name_mapping.csv")} - {""}:
        exists = await session.scalar(
            select(Product.id).where(
                Product.standard_id == DEFAULT_FOOD_STANDARD_ID, Product.name_ru == name
            )
        )
        if exists is None:
            session.add(
                Product(
                    name_ru=name,
                    category_id=category.id,
                    kcal_100g=100,
                    fat_100g=1,
                    protein_100g=1,
                    carbs_100g=1,
                    fiber_100g=0,
                    source="USDA",
                    source_version="SR28",
                    verified_at=date(2026, 1, 1),
                )
            )
    await session.flush()


@pytest.fixture
async def loaded(session, make_user):
    existing = await food_standards_repo.find_by_name(
        session, name=standard_documents.STANDARD_NAME
    )
    assert existing is None, "the development database already holds this standard"
    author = await make_user(role=UserRole.DIETITIAN)
    await _catalogue(session)
    report = await standard_documents.load(session, data_dir=DATA, author_id=author.id)
    standard = await food_standards_repo.find_by_name(
        session, name=standard_documents.STANDARD_NAME
    )
    return standard, report


async def test_every_accepted_product_has_a_mapping_row():
    # A missed row would let a child's exclusion pass through this standard.
    mapped = {row["name_ru"] for row in _rows("name_mapping.csv")}
    assert {row["name_ru"] for row in _rows("products.csv")} == mapped


async def test_mapping_points_at_real_catalogue_names():
    catalogue = {row["name_ru"] for row in _rows("../products-usda.csv")}
    targets = {row["catalog_name_ru"] for row in _rows("name_mapping.csv")} - {""}
    assert targets <= catalogue


async def test_every_document_dish_has_a_reviewed_name():
    raw = {row["dish"] for row in _rows("source_rows.csv")} - {""}
    names = {row["raw"]: row for row in _rows("dish_names.csv")}
    assert raw == names.keys()
    assert all(row["glued"] == "1" or row["title"] for row in names.values())


async def test_standard_is_locked_and_not_ketogenic(loaded):
    standard, report = loaded

    assert standard.locked_at is not None
    assert standard.diet_type is FoodDietType.GENERAL
    assert report.products == 36


async def test_everything_loaded_is_a_draft(session, loaded):
    standard, report = loaded

    published = await session.scalar(
        select(func.count())
        .select_from(Recipe)
        .where(Recipe.standard_id == standard.id, Recipe.status == RecipeStatus.PUBLISHED)
    )
    assert report.recipes > 0
    assert published == 0
    assert report.items_without_recipe > 0


async def test_mapped_product_shares_identity_with_the_catalogue(session, loaded):
    standard, _ = loaded

    catalogue = await session.scalar(
        select(Product).where(
            Product.standard_id == DEFAULT_FOOD_STANDARD_ID, Product.name_ru == "Яблоко"
        )
    )
    local = await session.scalar(
        select(Product).where(Product.standard_id == standard.id, Product.name_ru == "Яблоко")
    )
    assert local.food_id == catalogue.food_id


async def test_load_is_in_the_audit_log(session, loaded):
    standard, _ = loaded

    actions = await session.scalars(
        select(AuditLog.action).where(
            AuditLog.entity == "food_standards", AuditLog.entity_id == standard.id
        )
    )
    assert set(actions) == {"create", "lock"}


async def test_deploy_mode_loads_with_missing_links_and_reports_them(session, make_user):
    author = await make_user(role=UserRole.DIETITIAN)
    await _catalogue(session)
    apple = await session.scalar(
        select(Product).where(
            Product.standard_id == DEFAULT_FOOD_STANDARD_ID, Product.name_ru == "Яблоко"
        )
    )
    apple.name_ru = f"Яблоко {uuid.uuid4().hex[:6]}"
    await session.flush()

    report = await standard_documents.load(
        session, data_dir=DATA, author_id=author.id, require_all_links=False
    )

    assert report.products == 36
    assert any("Яблоко" in note for note in report.notes)


async def test_second_load_is_refused(session, make_user, loaded):
    author = await make_user(role=UserRole.DIETITIAN)

    with pytest.raises(standard_documents.AlreadyLoadedError):
        await standard_documents.load(session, data_dir=DATA, author_id=author.id)


async def test_search_keeps_general_dishes_out_of_the_library(
    client, auth_headers, make_user, session, loaded
):
    standard, _ = loaded
    dietitian = await make_user(role=UserRole.DIETITIAN)
    parent = await make_user(role=UserRole.PARENT)

    default = await client.get("/api/v1/recipes?limit=200", headers=auth_headers(dietitian))
    chosen = await client.get(
        f"/api/v1/recipes?limit=200&standard_id={standard.id}", headers=auth_headers(dietitian)
    )
    family = await client.get(
        f"/api/v1/recipes?limit=200&standard_id={standard.id}", headers=auth_headers(parent)
    )

    ids_chosen = {item["id"] for item in chosen.json()["items"]}
    assert chosen.json()["total"] > 0
    assert ids_chosen.isdisjoint({item["id"] for item in default.json()["items"]})
    assert ids_chosen.isdisjoint({item["id"] for item in family.json()["items"]})


async def test_locked_dish_is_not_changed_by_anyone(
    client, auth_headers, make_user, session, loaded
):
    standard, _ = loaded
    dietitian = await make_user(role=UserRole.DIETITIAN)
    recipe = await session.scalar(select(Recipe).where(Recipe.standard_id == standard.id).limit(1))

    published = await client.post(
        f"/api/v1/recipes/{recipe.id}/publish", headers=auth_headers(dietitian)
    )
    deleted = await client.delete(f"/api/v1/recipes/{recipe.id}", headers=auth_headers(dietitian))

    assert published.status_code == 409, published.text
    assert deleted.status_code == 409, deleted.text


class TestMenuTemplates:
    """Reader: the standards screen of the web cabinet."""

    async def test_specialist_reads_a_template_by_days(
        self, client, auth_headers, make_user, session, loaded
    ):
        standard, _ = loaded
        doctor = await make_user(role=UserRole.DOCTOR)

        listed = await client.get(
            f"/api/v1/food-standards/{standard.id}/menu-templates", headers=auth_headers(doctor)
        )
        assert listed.status_code == 200, listed.text
        assert len(listed.json()) >= 1
        detail = await client.get(
            f"/api/v1/food-standards/menu-templates/{listed.json()[0]['id']}",
            headers=auth_headers(doctor),
        )

        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["diet_type"] == "general"
        assert body["items"][0]["cycle_day"] == 1
        assert body["template"]["status"] == "draft"

    @pytest.mark.parametrize("role", [UserRole.PARENT, UserRole.ADMIN])
    async def test_others_are_refused(self, client, auth_headers, make_user, session, loaded, role):
        standard, _ = loaded
        user = await make_user(role=role)
        template = await session.scalar(
            select(MenuTemplate).where(MenuTemplate.standard_id == standard.id).limit(1)
        )

        listed = await client.get(
            f"/api/v1/food-standards/{standard.id}/menu-templates", headers=auth_headers(user)
        )
        detail = await client.get(
            f"/api/v1/food-standards/menu-templates/{template.id}", headers=auth_headers(user)
        )

        assert listed.status_code == 403
        assert detail.status_code == 403

    async def test_unknown_template_is_not_found(self, client, auth_headers, make_user):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.get(
            f"/api/v1/food-standards/menu-templates/{uuid.uuid4()}", headers=auth_headers(doctor)
        )

        assert response.status_code == 404


async def test_patient_recipe_fit_skips_a_general_draft(
    client, auth_headers, make_user, make_patient, session, loaded
):
    standard, _ = loaded
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
    recipe = await session.scalar(select(Recipe).where(Recipe.standard_id == standard.id).limit(1))

    response = await client.post(
        f"/api/v1/patients/{patient.id}/recipe-fits",
        json={"recipe_ids": [str(recipe.id)]},
        headers=auth_headers(doctor),
    )

    assert response.json()["items"][0]["status"] == "unavailable"


class TestWeightAtCreation:
    """Reader: the new patient form of the web cabinet."""

    BODY = {"full_name": "Тест", "birth_date": "2019-03-04", "sex": "f"}

    async def test_weight_goes_to_the_weight_diary(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        created = await client.post(
            "/api/v1/patients", json={**self.BODY, "weight_kg": 18.5}, headers=auth_headers(doctor)
        )

        assert created.status_code == 201, created.text
        logs = await client.get(
            f"/api/v1/patients/{created.json()['id']}/logs/weight", headers=auth_headers(doctor)
        )
        assert [item["weight_kg"] for item in logs.json()["items"]] == [18.5]

    async def test_weight_is_optional(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        created = await client.post(
            "/api/v1/patients", json=self.BODY, headers=auth_headers(doctor)
        )

        assert created.status_code == 201, created.text

    async def test_implausible_weight_is_rejected(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        created = await client.post(
            "/api/v1/patients", json={**self.BODY, "weight_kg": 400}, headers=auth_headers(doctor)
        )

        assert created.status_code == 422
