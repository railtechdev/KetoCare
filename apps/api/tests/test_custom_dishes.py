"""`/custom-dishes` — свои блюда родителя (раздел 5.3 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from core.models import CustomDish, Product, ProductCategory
from core.models.enums import UserRole
from core.repositories import patients as patients_repo
from keto_engine import ENGINE_VERSION

pytestmark = pytest.mark.asyncio


async def _product(session, name: str, **macros) -> Product:
    category = await session.scalar(select(ProductCategory).limit(1))
    if category is None:
        category = ProductCategory(name_ru="Тестовая", sort=0)
        session.add(category)
        await session.flush()

    product = Product(
        # Название уникально в пределах прогона: на products есть уникальный индекс
        # по нормализованному имени, а в базе разработчика уже лежат свои продукты.
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


BUTTER = dict(kcal_100g=717, fat_100g=81.1, protein_100g=0.9, carbs_100g=0.1, fiber_100g=0.0)
CHICKEN = dict(kcal_100g=165, fat_100g=3.6, protein_100g=31.0, carbs_100g=0.0, fiber_100g=0.0)


async def _linked_parent(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


class TestCreate:
    async def test_saves_dish_with_computed_and_engine_version(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/custom-dishes",
            json={
                "title": "Завтрак",
                "ingredients": [
                    {"product_id": str(butter.id), "grams": 50},
                    {"product_id": str(chicken.id), "grams": 40},
                ],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 201, response.text
        body = response.json()

        # 50 г масла + 40 г курицы: жиры 40.55 + 1.44, белки 0.45 + 12.4
        assert body["computed"]["fat"] == pytest.approx(41.99, abs=0.01)
        assert body["computed"]["protein"] == pytest.approx(12.85, abs=0.01)
        assert body["computed"]["ratio"] == pytest.approx(41.99 / 12.9, abs=0.01)
        assert body["engine_version"] == ENGINE_VERSION, (
            "сохранённый расчёт обязан нести версию движка (раздел 4.1 ТЗ)"
        )

    async def test_macros_come_from_database_not_request(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Клиент передаёт только product_id и граммы. Если бы состав считался по
        присланным макронутриентам, можно было бы получить «правильный» расчёт по
        выдуманным данным — а это блюдо ест ребёнок."""
        parent, patient = await _linked_parent(session, make_user, make_patient)
        butter = await _product(session, "Масло сливочное", **BUTTER)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/custom-dishes",
            json={
                "title": "Подмена",
                "ingredients": [
                    {"product_id": str(butter.id), "grams": 100, "fat": 0.1, "kcal": 1}
                ],
            },
            headers=auth_headers(parent),
        )
        # extra="forbid": лишние поля отклоняются, а не игнорируются молча
        assert response.status_code == 422

    async def test_unknown_product_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            f"/api/v1/patients/{patient.id}/custom-dishes",
            json={
                "title": "Блюдо",
                "ingredients": [{"product_id": str(uuid.uuid4()), "grams": 50}],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_duplicate_product_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Иначе массы одного продукта молча сложились бы."""
        parent, patient = await _linked_parent(session, make_user, make_patient)
        butter = await _product(session, "Масло сливочное", **BUTTER)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/custom-dishes",
            json={
                "title": "Дубль",
                "ingredients": [
                    {"product_id": str(butter.id), "grams": 30},
                    {"product_id": str(butter.id), "grams": 20},
                ],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422
        assert "несколько раз" in response.json()["error"]["message"]

    @pytest.mark.parametrize(
        "ingredients",
        [
            [],  # пустой состав
            [{"product_id": "00000000-0000-0000-0000-000000000000", "grams": 0}],
            [{"product_id": "00000000-0000-0000-0000-000000000000", "grams": -5}],
        ],
    )
    async def test_invalid_payload_rejected(
        self, client, session, make_user, make_patient, auth_headers, ingredients
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            f"/api/v1/patients/{patient.id}/custom-dishes",
            json={"title": "X", "ingredients": ingredients},
            headers=auth_headers(parent),
        )
        assert response.status_code == 422


class TestAccessControl:
    async def test_other_patients_dishes_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        other_child = await make_patient("Чужой")

        response = await client.get(
            f"/api/v1/patients/{other_child.id}/custom-dishes", headers=auth_headers(parent)
        )
        assert response.status_code == 403

    async def test_dish_of_another_patient_not_reachable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Доступ к пациенту не даёт прав на запись, привязанную к другому."""
        parent, patient = await _linked_parent(session, make_user, make_patient)
        other_parent, other_patient = await _linked_parent(session, make_user, make_patient)
        butter = await _product(session, "Масло сливочное", **BUTTER)

        created = await client.post(
            f"/api/v1/patients/{other_patient.id}/custom-dishes",
            json={
                "title": "Чужое блюдо",
                "ingredients": [{"product_id": str(butter.id), "grams": 40}],
            },
            headers=auth_headers(other_parent),
        )
        dish_id = created.json()["id"]

        response = await client.put(
            f"/api/v1/patients/{patient.id}/custom-dishes/{dish_id}",
            json={
                "title": "Перехват",
                "ingredients": [{"product_id": str(butter.id), "grams": 10}],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 404, "чужая запись не должна быть достижима"


class TestUpdateAndDelete:
    async def test_update_recomputes(self, client, session, make_user, make_patient, auth_headers):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        url = f"/api/v1/patients/{patient.id}/custom-dishes"

        created = await client.post(
            url,
            json={
                "title": "Блюдо",
                "ingredients": [{"product_id": str(butter.id), "grams": 50}],
            },
            headers=auth_headers(parent),
        )
        dish_id = created.json()["id"]
        before = created.json()["computed"]["fat"]

        updated = await client.put(
            f"{url}/{dish_id}",
            json={
                "title": "Блюдо побольше",
                "ingredients": [{"product_id": str(butter.id), "grams": 100}],
            },
            headers=auth_headers(parent),
        )
        assert updated.status_code == 200
        assert updated.json()["computed"]["fat"] == pytest.approx(before * 2, abs=0.01)

    async def test_delete_is_soft(self, client, session, make_user, make_patient, auth_headers):
        """Правило 4 CLAUDE.md: клинические записи физически не удаляются."""
        parent, patient = await _linked_parent(session, make_user, make_patient)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        url = f"/api/v1/patients/{patient.id}/custom-dishes"

        created = await client.post(
            url,
            json={
                "title": "Удаляемое",
                "ingredients": [{"product_id": str(butter.id), "grams": 30}],
            },
            headers=auth_headers(parent),
        )
        dish_id = created.json()["id"]

        deleted = await client.delete(f"{url}/{dish_id}", headers=auth_headers(parent))
        assert deleted.status_code == 204

        listing = await client.get(url, headers=auth_headers(parent))
        assert listing.json()["total"] == 0, "удалённое блюдо не показывается"

        row = await session.scalar(select(CustomDish).where(CustomDish.id == dish_id))
        assert row is not None, "строка остаётся в БД"
        assert row.deleted_at is not None
