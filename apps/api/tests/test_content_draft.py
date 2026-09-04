"""`content_draft`: черновик карточки рецепта и проверка базы на аномалии (п. 21)."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

import pytest

from api.services import queue as queue_service
from core.models import Product, ProductCategory
from core.models.enums import UserRole

pytestmark = pytest.mark.asyncio


async def _product(session, **overrides: Any) -> Product:
    category = ProductCategory(name_ru=f"Категория {uuid.uuid4().hex[:6]}", sort=0)
    session.add(category)
    await session.flush()

    values: dict[str, Any] = {
        "name_ru": f"Продукт {uuid.uuid4().hex[:8]}",
        "category_id": category.id,
        "kcal_100g": 717,
        "fat_100g": 81.1,
        "protein_100g": 0.9,
        "carbs_100g": 0.1,
        "fiber_100g": 0.0,
        "source": "USDA",
        "source_version": "SR28",
        "verified_at": date(2026, 1, 1),
    }
    values.update(overrides)
    product = Product(**values)
    session.add(product)
    await session.flush()
    return product


def _draft_body(product_id) -> dict[str, Any]:
    return {
        "title": "Омлет на сливочном масле",
        "category": "breakfast",
        "servings": 1,
        "ingredients": [{"product_id": str(product_id), "grams": 30}],
    }


class TestRecipeDraft:
    async def test_dietitian_gets_the_steps(
        self, client, session, make_user, auth_headers, monkeypatch
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        product = await _product(session)

        async def fake_run(task: str, *args: Any, timeout_s: float) -> dict[str, Any]:
            assert task == "content_draft"
            return {
                "status": "ok",
                "instructions": "1. Растопите масло.\n2. Взбейте яйца.",
                "checks": [],
                "ai_job_id": str(uuid.uuid4()),
            }

        monkeypatch.setattr(queue_service, "run", fake_run)

        response = await client.post(
            "/api/v1/ai/recipe-draft",
            json=_draft_body(product.id),
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 200, response.text
        assert response.json()["instructions"].startswith("1. Растопите")

    async def test_the_model_gets_names_and_grams_but_not_ids(
        self, client, session, make_user, auth_headers, monkeypatch
    ):
        """Состав подставляет сервер: модель не должна ни выбирать продукты, ни
        видеть идентификаторы, которых она всё равно не проверит."""

        dietitian = await make_user(UserRole.DIETITIAN)
        product = await _product(session, name_ru="Масло сливочное 82%")
        seen: dict[str, Any] = {}

        async def fake_run(task: str, *args: Any, timeout_s: float) -> dict[str, Any]:
            seen["payload"] = args[-1]
            return {"status": "ok", "instructions": "1. Шаг.", "checks": [], "ai_job_id": None}

        monkeypatch.setattr(queue_service, "run", fake_run)

        await client.post(
            "/api/v1/ai/recipe-draft",
            json=_draft_body(product.id),
            headers=auth_headers(dietitian),
        )

        assert seen["payload"]["ingredients"] == [{"name_ru": "Масло сливочное 82%", "grams": 30.0}]
        assert str(product.id) not in str(seen["payload"])

    async def test_an_unknown_product_is_a_validation_error(
        self, client, session, make_user, auth_headers
    ):
        """Продукт вне справочника — ошибка запроса, а не повод его придумать."""

        dietitian = await make_user(UserRole.DIETITIAN)

        response = await client.post(
            "/api/v1/ai/recipe-draft",
            json=_draft_body(uuid.uuid4()),
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_parent_may_not_ask_for_a_draft(self, client, session, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)
        product = await _product(session)

        response = await client.post(
            "/api/v1/ai/recipe-draft",
            json=_draft_body(product.id),
            headers=auth_headers(parent),
        )

        assert response.status_code == 403

    async def test_a_limit_becomes_rate_limited(
        self, client, session, make_user, auth_headers, monkeypatch
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        product = await _product(session)

        async def fake_run(task: str, *args: Any, timeout_s: float) -> dict[str, Any]:
            return {"status": "limited", "message": "На сегодня хватит."}

        monkeypatch.setattr(queue_service, "run", fake_run)

        response = await client.post(
            "/api/v1/ai/recipe-draft",
            json=_draft_body(product.id),
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 429
        assert response.json()["error"]["code"] == "rate_limited"

    async def test_a_timeout_degrades_softly(
        self, client, session, make_user, auth_headers, monkeypatch
    ):
        """Раздел 10.2 ТЗ: недоступный ИИ ничего больше не ломает."""

        dietitian = await make_user(UserRole.DIETITIAN)
        product = await _product(session)

        async def fake_run(task: str, *args: Any, timeout_s: float) -> dict[str, Any]:
            raise queue_service.TaskTimeout("не успел")

        monkeypatch.setattr(queue_service, "run", fake_run)

        response = await client.post(
            "/api/v1/ai/recipe-draft",
            json=_draft_body(product.id),
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 503


class TestProductAnomalies:
    async def test_a_correct_product_is_not_reported(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        await _product(session, name_ru="Масло сливочное эталонное")

        response = await client.get("/api/v1/products/anomalies", headers=auth_headers(admin))

        assert response.status_code == 200, response.text
        names = [item["name_ru"] for item in response.json()["items"]]
        assert "Масло сливочное эталонное" not in names

    async def test_macros_over_a_hundred_grams_are_reported(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        await _product(
            session,
            name_ru="Невозможный продукт",
            kcal_100g=500,
            fat_100g=60,
            protein_100g=30,
            carbs_100g=30,
        )

        response = await client.get("/api/v1/products/anomalies", headers=auth_headers(admin))

        found = {item["name_ru"]: item for item in response.json()["items"]}
        assert "Невозможный продукт" in found
        kinds = {check["kind"] for check in found["Невозможный продукт"]["anomalies"]}
        assert "macro_sum" in kinds

    async def test_kilojoules_written_as_kilocalories_are_reported(
        self, client, session, make_user, auth_headers
    ):
        """Разница в 4,2 раза — самая частая ошибка переноса из чужой таблицы."""

        admin = await make_user(UserRole.ADMIN)
        await _product(session, name_ru="Масло в килоджоулях", kcal_100g=3000)

        response = await client.get("/api/v1/products/anomalies", headers=auth_headers(admin))

        found = {item["name_ru"]: item for item in response.json()["items"]}
        kinds = {check["kind"] for check in found["Масло в килоджоулях"]["anomalies"]}
        assert "kcal_mismatch" in kinds

    async def test_the_whole_base_is_scanned_not_just_the_page(
        self, client, session, make_user, auth_headers
    ):
        """«Аномалий нет» обязано означать «нет в базе», а не «нет на странице»."""

        admin = await make_user(UserRole.ADMIN)
        for index in range(3):
            await _product(
                session,
                name_ru=f"Плохой продукт {index}",
                kcal_100g=500,
                fat_100g=60,
                protein_100g=30,
                carbs_100g=30,
            )

        response = await client.get(
            "/api/v1/products/anomalies?limit=1&offset=0", headers=auth_headers(admin)
        )

        body = response.json()
        assert len(body["items"]) == 1
        assert body["total"] >= 3

    async def test_parent_may_not_read_the_anomalies(
        self, client, session, make_user, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)

        response = await client.get("/api/v1/products/anomalies", headers=auth_headers(parent))

        assert response.status_code == 403
