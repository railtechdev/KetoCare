"""`/recipes` — общая база рецептов (раздел 5.3 ТЗ).

Проверяется главное: итоги рецепта считает только ядро и только по продуктам из
базы, сохраняются они вместе с engine_version, родителю видны лишь
опубликованные рецепты, а каждая правка попадает в audit_log.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import date

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps.auth import get_session
from api.main import create_app
from api.routers.recipes import router as recipes_router
from core.models import AuditLog, Product, ProductCategory, Recipe, RecipeIngredient
from core.models.enums import RecipeStatus, UserRole
from keto_engine import ENGINE_VERSION

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """Роутер рецептов подключается к приложению прямо здесь: в `main.py` его
    добавляет координатор, а тест обязан проходить сам по себе."""

    app = create_app()
    app.include_router(recipes_router, prefix="/api/v1")

    async def _override_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _override_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client


BUTTER = dict(kcal_100g=717, fat_100g=81.1, protein_100g=0.9, carbs_100g=0.1, fiber_100g=0.0)
CHICKEN = dict(kcal_100g=165, fat_100g=3.6, protein_100g=31.0, carbs_100g=0.0, fiber_100g=0.0)
# Чистый жир: белков и углеводов нет, поэтому соотношение не определено (ratio = null)
OIL = dict(kcal_100g=884, fat_100g=100.0, protein_100g=0.0, carbs_100g=0.0, fiber_100g=0.0)


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


def _payload(*ingredients: tuple[Product, float], **overrides) -> dict:
    payload: dict = {
        "title": "Омлет на сливочном масле",
        "category": "breakfast",
        "yield_g": 150,
        "servings": 1,
        "instructions": "Растопить масло, влить смесь, готовить под крышкой.",
        "ingredients": [
            {"product_id": str(product.id), "grams": grams} for product, grams in ingredients
        ],
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def make_recipe(client, session, make_user, auth_headers):
    """Черновик рецепта, созданный диетологом."""

    async def _make(*ingredients: tuple[Product, float], **overrides) -> dict:
        author = overrides.pop("author", None) or await make_user(UserRole.DIETITIAN)
        if not ingredients and "ingredients" not in overrides:
            butter = await _product(session, "Масло сливочное", **BUTTER)
            ingredients = ((butter, 100),)

        response = await client.post(
            "/api/v1/recipes",
            json=_payload(*ingredients, **overrides),
            headers=auth_headers(author),
        )
        assert response.status_code == 201, response.text
        return response.json()

    return _make


class TestWriteAccess:
    @pytest.mark.parametrize("role", [UserRole.PARENT, UserRole.DOCTOR])
    async def test_only_admin_and_dietitian_write(
        self, client, session, make_user, auth_headers, role
    ):
        """Раздел 5.3 ТЗ: CRUD рецептов — admin/dietitian."""

        user = await make_user(role)
        butter = await _product(session, "Масло сливочное", **BUTTER)

        response = await client.post(
            "/api/v1/recipes", json=_payload((butter, 100)), headers=auth_headers(user)
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "forbidden"

    async def test_parent_cannot_publish(self, client, make_user, auth_headers, make_recipe):
        parent = await make_user(UserRole.PARENT)
        recipe = await make_recipe()

        response = await client.post(
            f"/api/v1/recipes/{recipe['id']}/publish", headers=auth_headers(parent)
        )
        assert response.status_code == 403

    async def test_admin_may_write(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        butter = await _product(session, "Масло сливочное", **BUTTER)

        response = await client.post(
            "/api/v1/recipes", json=_payload((butter, 100)), headers=auth_headers(admin)
        )
        assert response.status_code == 201, response.text


class TestCreate:
    async def test_creates_draft_with_computed_from_database(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)

        response = await client.post(
            "/api/v1/recipes", json=_payload((butter, 100)), headers=auth_headers(dietitian)
        )
        assert response.status_code == 201, response.text
        body = response.json()

        assert body["status"] == "draft", "публикация — отдельное действие (раздел 5.3 ТЗ)"
        assert body["author_id"] == str(dietitian.id)
        # 100 г масла: жиры 81.1, белки 0.9, углеводы 0.1 — значения из products
        assert body["computed"]["fat"] == pytest.approx(81.1, abs=0.01)
        assert body["computed"]["protein"] == pytest.approx(0.9, abs=0.01)
        assert body["computed"]["ratio"] == pytest.approx(81.1, abs=0.01)
        assert body["engine_version"] == ENGINE_VERSION, (
            "сохранённый расчёт обязан нести версию движка (раздел 4.1 ТЗ)"
        )
        assert body["ingredients"] == [
            {"product_id": str(butter.id), "grams": 100.0, "position": 0}
        ]

    async def test_position_follows_order_of_ingredients(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)

        response = await client.post(
            "/api/v1/recipes",
            json=_payload((chicken, 40), (butter, 50)),
            headers=auth_headers(dietitian),
        )
        body = response.json()
        assert [i["product_id"] for i in body["ingredients"]] == [str(chicken.id), str(butter.id)]
        assert [i["position"] for i in body["ingredients"]] == [0, 1]

    async def test_macros_come_from_database_not_request(
        self, client, session, make_user, auth_headers
    ):
        """Клиент присылает только product_id и граммы: иначе можно было бы получить
        «правильный» расчёт по выдуманным макронутриентам."""

        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)

        response = await client.post(
            "/api/v1/recipes",
            json=_payload(ingredients=[{"product_id": str(butter.id), "grams": 100, "fat": 0.1}]),
            headers=auth_headers(dietitian),
        )
        # extra="forbid": лишние поля отклоняются, а не игнорируются молча
        assert response.status_code == 422

    async def test_unknown_product_rejected(self, client, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        response = await client.post(
            "/api/v1/recipes",
            json=_payload(ingredients=[{"product_id": str(uuid.uuid4()), "grams": 50}]),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_duplicate_product_rejected(self, client, session, make_user, auth_headers):
        """Иначе массы одного продукта молча сложились бы."""

        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)

        response = await client.post(
            "/api/v1/recipes",
            json=_payload((butter, 30), (butter, 20)),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 422
        assert "несколько раз" in response.json()["error"]["message"]

    @pytest.mark.parametrize(
        "overrides",
        [
            {"title": ""},
            {"category": "supper"},
            {"servings": 0},
            {"yield_g": 0},
            {"instructions": ""},
            {"ingredients": [{"product_id": str(uuid.uuid4()), "grams": 0}]},
            {"ingredients": [{"product_id": "не-uuid", "grams": 10}]},
        ],
    )
    async def test_invalid_payload_rejected(
        self, client, session, make_user, auth_headers, overrides
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)

        response = await client.post(
            "/api/v1/recipes",
            json=_payload((butter, 100), **overrides),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 422


class TestPublish:
    async def test_publish_fixes_computed_engine_version_and_audit(
        self, client, session, make_user, auth_headers, make_recipe
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        chicken = await _product(session, "Курица", **CHICKEN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await make_recipe((butter, 50), (chicken, 40), author=dietitian)

        response = await client.post(
            f"/api/v1/recipes/{recipe['id']}/publish", headers=auth_headers(dietitian)
        )
        assert response.status_code == 200, response.text
        body = response.json()

        assert body["status"] == "published"
        # 50 г масла + 40 г курицы: жиры 40.55 + 1.44, белки 0.45 + 12.4
        assert body["computed"]["fat"] == pytest.approx(41.99, abs=0.01)
        assert body["computed"]["protein"] == pytest.approx(12.85, abs=0.01)
        assert body["computed"]["ratio"] == pytest.approx(41.99 / 12.9, abs=0.01)
        assert body["engine_version"] == ENGINE_VERSION

        row = await session.get(Recipe, uuid.UUID(recipe["id"]))
        assert row is not None
        assert row.status is RecipeStatus.PUBLISHED
        assert row.engine_version == ENGINE_VERSION

        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "recipes",
                AuditLog.action == "publish",
                AuditLog.entity_id == uuid.UUID(recipe["id"]),
            )
        )
        assert entry is not None, "публикация рецепта обязана попадать в audit_log (раздел 4.2 ТЗ)"
        assert entry.before is not None and entry.before["status"] == "draft"
        assert entry.after is not None and entry.after["status"] == "published"

    async def test_publish_recomputes_from_current_products(
        self, client, session, make_user, auth_headers, make_recipe
    ):
        """Публикация считает заново по текущим продуктам, а не берёт сохранённое:
        если продукт исправили после создания черновика, семья должна увидеть
        показатели, соответствующие базе."""

        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await make_recipe((butter, 100), author=dietitian)
        assert recipe["computed"]["fat"] == pytest.approx(81.1, abs=0.01)

        butter.fat_100g = 60.0
        await session.flush()

        response = await client.post(
            f"/api/v1/recipes/{recipe['id']}/publish", headers=auth_headers(dietitian)
        )
        assert response.status_code == 200, response.text
        assert response.json()["computed"]["fat"] == pytest.approx(60.0, abs=0.01)

    async def test_recipe_without_ingredients_not_published(
        self, client, session, make_user, auth_headers, make_recipe
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        recipe = await make_recipe(author=dietitian, ingredients=[])
        assert recipe["computed"] is None

        response = await client.post(
            f"/api/v1/recipes/{recipe['id']}/publish", headers=auth_headers(dietitian)
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

        row = await session.get(Recipe, uuid.UUID(recipe["id"]))
        assert row is not None and row.status is RecipeStatus.DRAFT

    async def test_publish_unknown_recipe_is_404(self, client, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        response = await client.post(
            f"/api/v1/recipes/{uuid.uuid4()}/publish", headers=auth_headers(dietitian)
        )
        assert response.status_code == 404


class TestVisibility:
    async def test_parent_sees_only_published(
        self, client, session, make_user, auth_headers, make_recipe
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        parent = await make_user(UserRole.PARENT)

        draft = await make_recipe(author=dietitian, title="Черновик омлета")
        published = await make_recipe(author=dietitian, title="Готовый омлет")
        await client.post(
            f"/api/v1/recipes/{published['id']}/publish", headers=auth_headers(dietitian)
        )

        listing = await client.get("/api/v1/recipes?limit=200", headers=auth_headers(parent))
        ids = [item["id"] for item in listing.json()["items"]]
        assert published["id"] in ids
        assert draft["id"] not in ids, "черновик не показывается родителю (раздел 5.3 ТЗ)"

        editor_listing = await client.get(
            "/api/v1/recipes?limit=200", headers=auth_headers(dietitian)
        )
        editor_ids = {item["id"] for item in editor_listing.json()["items"]}
        assert {draft["id"], published["id"]} <= editor_ids

    async def test_draft_hidden_from_parent_as_404(
        self, client, make_user, auth_headers, make_recipe
    ):
        """404, а не 403: иначе по коду ответа можно узнать о существовании рецепта."""

        parent = await make_user(UserRole.PARENT)
        draft = await make_recipe()

        response = await client.get(f"/api/v1/recipes/{draft['id']}", headers=auth_headers(parent))
        assert response.status_code == 404

    async def test_parent_reads_published_recipe(
        self, client, make_user, auth_headers, make_recipe
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        parent = await make_user(UserRole.PARENT)
        recipe = await make_recipe(author=dietitian)
        await client.post(
            f"/api/v1/recipes/{recipe['id']}/publish", headers=auth_headers(dietitian)
        )

        response = await client.get(f"/api/v1/recipes/{recipe['id']}", headers=auth_headers(parent))
        assert response.status_code == 200
        assert response.json()["status"] == "published"

    async def test_anonymous_request_rejected(self, client, make_recipe):
        recipe = await make_recipe()
        response = await client.get(f"/api/v1/recipes/{recipe['id']}")
        assert response.status_code == 401


class TestUpdate:
    async def test_update_recomputes_and_audits_before_after(
        self, client, session, make_user, auth_headers, make_recipe
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await make_recipe((butter, 50), author=dietitian)

        response = await client.put(
            f"/api/v1/recipes/{recipe['id']}",
            json=_payload((butter, 100), title="Омлет побольше"),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["title"] == "Омлет побольше"
        assert body["computed"]["fat"] == pytest.approx(recipe["computed"]["fat"] * 2, abs=0.01)

        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "recipes",
                AuditLog.action == "update",
                AuditLog.entity_id == uuid.UUID(recipe["id"]),
            )
        )
        assert entry is not None, "правка рецепта обязана попадать в audit_log (раздел 4.2 ТЗ)"
        assert entry.before is not None and entry.before["title"] == recipe["title"]
        assert entry.after is not None and entry.after["title"] == "Омлет побольше"

    async def test_published_recipe_keeps_status_and_fresh_computed(
        self, client, session, make_user, auth_headers, make_recipe
    ):
        """Опубликованный рецепт после правки состава не должен показывать
        показатели прежнего набора продуктов."""

        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        recipe = await make_recipe((butter, 100), author=dietitian)
        await client.post(
            f"/api/v1/recipes/{recipe['id']}/publish", headers=auth_headers(dietitian)
        )

        response = await client.put(
            f"/api/v1/recipes/{recipe['id']}",
            json=_payload((chicken, 100)),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "published"
        assert body["computed"]["protein"] == pytest.approx(31.0, abs=0.01)
        assert body["engine_version"] == ENGINE_VERSION

    async def test_update_replaces_composition(
        self, client, session, make_user, auth_headers, make_recipe
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        recipe = await make_recipe((butter, 50), (chicken, 40), author=dietitian)

        await client.put(
            f"/api/v1/recipes/{recipe['id']}",
            json=_payload((chicken, 40)),
            headers=auth_headers(dietitian),
        )

        rows = list(
            await session.scalars(
                select(RecipeIngredient).where(
                    RecipeIngredient.recipe_id == uuid.UUID(recipe["id"])
                )
            )
        )
        assert [row.product_id for row in rows] == [chicken.id], "старый состав не остаётся"

    async def test_update_unknown_recipe_is_404(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)

        response = await client.put(
            f"/api/v1/recipes/{uuid.uuid4()}",
            json=_payload((butter, 50)),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 404


class TestSearch:
    async def test_filters_by_category(self, client, make_user, auth_headers, make_recipe):
        dietitian = await make_user(UserRole.DIETITIAN)
        breakfast = await make_recipe(author=dietitian, category="breakfast")
        dessert = await make_recipe(author=dietitian, category="dessert")

        response = await client.get(
            "/api/v1/recipes?category=dessert&limit=200", headers=auth_headers(dietitian)
        )
        ids = [item["id"] for item in response.json()["items"]]
        assert dessert["id"] in ids
        assert breakfast["id"] not in ids

    async def test_filters_by_ratio_range(
        self, client, session, make_user, auth_headers, make_recipe
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)

        oil = await _product(session, "Масло растительное", **OIL)

        fatty = await make_recipe((butter, 100), author=dietitian)  # ratio ~81
        lean = await make_recipe((chicken, 100), author=dietitian)  # ratio ~0.12
        no_composition = await make_recipe(author=dietitian, ingredients=[])
        # Состав без белков и углеводов: соотношение не определено
        undefined_ratio = await make_recipe((oil, 50), author=dietitian)
        assert undefined_ratio["computed"]["ratio"] is None

        response = await client.get(
            "/api/v1/recipes?ratio_min=3&limit=200", headers=auth_headers(dietitian)
        )
        ids = [item["id"] for item in response.json()["items"]]
        assert fatty["id"] in ids
        assert lean["id"] not in ids
        assert no_composition["id"] not in ids, (
            "рецепт без расчёта не подставляется под диапазон соотношения"
        )
        assert undefined_ratio["id"] not in ids, (
            "рецепт с неопределённым соотношением тоже не подставляется под диапазон"
        )

        upper = await client.get(
            "/api/v1/recipes?ratio_max=1&limit=200", headers=auth_headers(dietitian)
        )
        upper_ids = [item["id"] for item in upper.json()["items"]]
        assert lean["id"] in upper_ids
        assert fatty["id"] not in upper_ids
        assert undefined_ratio["id"] not in upper_ids

    async def test_searches_by_title(self, client, make_user, auth_headers, make_recipe):
        dietitian = await make_user(UserRole.DIETITIAN)
        omelette = await make_recipe(author=dietitian, title="Омлет на сливочном масле")
        soup = await make_recipe(author=dietitian, title="Суп с курицей")

        response = await client.get(
            "/api/v1/recipes?q=омлет&limit=200", headers=auth_headers(dietitian)
        )
        ids = [item["id"] for item in response.json()["items"]]
        assert omelette["id"] in ids
        assert soup["id"] not in ids

    async def test_pagination(self, client, make_user, auth_headers, make_recipe):
        dietitian = await make_user(UserRole.DIETITIAN)
        baseline = await client.get("/api/v1/recipes?limit=1", headers=auth_headers(dietitian))
        before_total = baseline.json()["total"]

        for index in range(3):
            await make_recipe(author=dietitian, title=f"Рецепт {index}")

        page = await client.get("/api/v1/recipes?limit=2&offset=0", headers=auth_headers(dietitian))
        assert page.json()["total"] == before_total + 3
        assert len(page.json()["items"]) == 2

    @pytest.mark.parametrize(
        "query", ["limit=0", "limit=500", "offset=-1", "ratio_min=-1", "category=supper"]
    )
    async def test_invalid_query_rejected(self, client, make_user, auth_headers, query):
        dietitian = await make_user(UserRole.DIETITIAN)
        response = await client.get(f"/api/v1/recipes?{query}", headers=auth_headers(dietitian))
        assert response.status_code == 422


class TestDeleteRecipe:
    """ТЗ раздел 5.3 перечисляет для рецептов CRUD — удаление входит."""

    async def test_editor_deletes_unused_recipe(self, client, make_user, auth_headers, make_recipe):
        admin = await make_user(UserRole.ADMIN)
        recipe = await make_recipe()

        response = await client.delete(
            f"/api/v1/recipes/{recipe['id']}", headers=auth_headers(admin)
        )
        assert response.status_code == 204

        gone = await client.get(f"/api/v1/recipes/{recipe['id']}", headers=auth_headers(admin))
        assert gone.status_code == 404

    async def test_parent_cannot_delete(self, client, make_user, auth_headers, make_recipe):
        parent = await make_user(UserRole.PARENT)
        recipe = await make_recipe()

        response = await client.delete(
            f"/api/v1/recipes/{recipe['id']}", headers=auth_headers(parent)
        )
        assert response.status_code == 403

    async def test_missing_recipe_gives_404(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        response = await client.delete(
            f"/api/v1/recipes/{uuid.uuid4()}", headers=auth_headers(admin)
        )
        assert response.status_code == 404

    async def test_recipe_used_in_menu_is_not_deleted(
        self, client, session, make_user, make_patient, auth_headers, make_recipe
    ):
        """Меню — история питания ребёнка: удаление рецепта из прошлого меню
        лишило бы врача состава того приёма пищи."""
        from datetime import date as date_type

        from core.models import Menu, MenuItem
        from core.models.enums import MealSlot

        admin = await make_user(UserRole.ADMIN)
        patient = await make_patient()
        recipe = await make_recipe()
        recipe_id = uuid.UUID(recipe["id"])

        menu = Menu(patient_id=patient.id, date=date_type(2026, 5, 1))
        session.add(menu)
        await session.flush()
        session.add(
            MenuItem(
                menu_id=menu.id,
                patient_id=patient.id,
                meal_slot=MealSlot.BREAKFAST,
                recipe_id=recipe_id,
                portion_factor=1,
            )
        )
        await session.flush()

        response = await client.delete(f"/api/v1/recipes/{recipe_id}", headers=auth_headers(admin))
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "conflict"

        still_there = await client.get(f"/api/v1/recipes/{recipe_id}", headers=auth_headers(admin))
        assert still_there.status_code == 200
