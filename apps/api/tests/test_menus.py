"""`/menus` — меню дня (раздел 5.3 ТЗ)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Sequence
from datetime import date

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from api.deps.auth import get_session
from api.main import API_PREFIX, create_app
from api.routers.menus import router as menus_router
from core.models import (
    CustomDish,
    Menu,
    MenuItem,
    Product,
    ProductCategory,
    Recipe,
    RecipeIngredient,
)
from core.models.enums import RecipeCategory, RecipeStatus, UserRole
from core.repositories import patients as patients_repo
from keto_engine import ENGINE_VERSION

pytestmark = pytest.mark.asyncio

MENU_DATE = "2026-03-02"

BUTTER = dict(kcal_100g=717, fat_100g=81.1, protein_100g=0.9, carbs_100g=0.1, fiber_100g=0.0)
CHICKEN = dict(kcal_100g=165, fat_100g=3.6, protein_100g=31.0, carbs_100g=0.0, fiber_100g=0.0)


@pytest_asyncio.fixture
async def client(session) -> AsyncIterator[AsyncClient]:
    """Роутер меню подключает к приложению координатор (main.py). Пока этого не
    произошло, тест подключает его сам — иначе файл не проходит в одиночку."""

    app = create_app()
    menus_prefix = f"{API_PREFIX}{menus_router.prefix}"
    if not any(getattr(route, "path", "").startswith(menus_prefix) for route in app.routes):
        app.include_router(menus_router, prefix=API_PREFIX)

    async def _override_session():
        yield session

    app.dependency_overrides[get_session] = _override_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client


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


async def _recipe(
    session,
    author,
    *,
    ingredients: Sequence[tuple[Product, float]],
    status: RecipeStatus = RecipeStatus.PUBLISHED,
    servings: int = 1,
) -> Recipe:
    recipe = Recipe(
        title=f"Рецепт {uuid.uuid4().hex[:8]}",
        category=RecipeCategory.BREAKFAST,
        yield_g=100,
        servings=servings,
        instructions="Смешать",
        status=status,
        author_id=author.id,
    )
    session.add(recipe)
    await session.flush()
    for position, (product, grams) in enumerate(ingredients):
        session.add(
            RecipeIngredient(
                recipe_id=recipe.id, product_id=product.id, grams=grams, position=position
            )
        )
    await session.flush()
    return recipe


async def _custom_dish(session, patient, *, ingredients: Sequence[tuple[Product, float]]):
    dish = CustomDish(
        patient_id=patient.id,
        title="Своё блюдо",
        ingredients=[
            {"product_id": str(product.id), "grams": grams} for product, grams in ingredients
        ],
    )
    session.add(dish)
    await session.flush()
    return dish


async def _linked_parent(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


def _url(patient) -> str:
    return f"/api/v1/patients/{patient.id}/menus"


class TestUpsert:
    async def test_totals_are_computed_by_engine_and_stored_with_version(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])
        dish = await _custom_dish(session, patient, ingredients=[(chicken, 40)])

        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [
                    {"meal_slot": "breakfast", "recipe_id": str(recipe.id)},
                    {"meal_slot": "lunch", "custom_dish_id": str(dish.id)},
                ],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 200, response.text
        body = response.json()

        # 50 г масла + 40 г курицы: жиры 40.55 + 1.44, белки 0.45 + 12.4, углеводы 0.05
        assert body["totals"]["fat"] == pytest.approx(41.99, abs=0.01)
        assert body["totals"]["protein"] == pytest.approx(12.85, abs=0.01)
        assert body["totals"]["ratio"] == pytest.approx(41.99 / 12.9, abs=0.01)
        assert body["engine_version"] == ENGINE_VERSION, (
            "сохранённые итоги обязаны нести версию движка (раздел 4.1 ТЗ)"
        )
        assert [item["meal_slot"] for item in body["items"]] == ["breakfast", "lunch"]
        assert all(item["eaten"] is False for item in body["items"])

    async def test_portion_factor_scales_totals(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [
                    {"meal_slot": "breakfast", "recipe_id": str(recipe.id), "portion_factor": 0.5}
                ],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 200, response.text
        # Половина порции: 25 г масла вместо 50 г
        assert response.json()["totals"]["fat"] == pytest.approx(20.275, abs=0.01)

    async def test_one_portion_of_a_four_serving_recipe_is_a_quarter(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Множитель — это ЧИСЛО ПОРЦИЙ, а не доля выхода рецепта.

        Состав рецепта записан на весь выход. Пока `servings` не участвовал в
        расчёте, множитель 1 означал противень: блюдо на четверых уходило в день
        ребёнка целиком. Ошибка тихая — день сходился как «переедание», то есть
        выглядела поведением семьи, а не подстановкой. Весь набор её не видел
        ровно потому, что каждый тест брал рецепт на одну порцию.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 200)], servings=4)

        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
        # 200 г масла на 4 порции = 50 г в порции: жиры 81.1 × 0.5 = 40.55.
        # До правки здесь было бы 162.2 — четырёхкратная норма.
        assert response.json()["totals"]["fat"] == pytest.approx(40.55, abs=0.01)

    async def test_two_portions_of_a_four_serving_recipe_is_a_half(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 200)], servings=4)

        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [
                    {"meal_slot": "breakfast", "recipe_id": str(recipe.id), "portion_factor": 2}
                ],
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
        # Две порции из четырёх — половина выхода: 100 г масла, жиры 81.1.
        assert response.json()["totals"]["fat"] == pytest.approx(81.1, abs=0.01)

    async def test_custom_dish_is_one_portion_by_definition(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Своё блюдо родитель приготовил под этот приём пищи, а не на семью.

        Знаменатель у него единица, поэтому смысл поля одинаков в обеих ветках,
        а числа своих блюд правкой не затронуты.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        chicken = await _product(session, "Курица", **CHICKEN)
        dish = await _custom_dish(session, patient, ingredients=[(chicken, 100)])

        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "lunch", "custom_dish_id": str(dish.id)}],
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
        assert response.json()["totals"]["protein"] == pytest.approx(31.0, abs=0.01)

    async def test_portion_factor_is_rounded_to_stored_precision(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """`portion_factor` — numeric(4,2). Итоги обязаны считаться по тому
        множителю, который реально ляжет в базу, иначе сохранённые показатели
        не соответствуют сохранённому плану."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 100)])

        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [
                    {"meal_slot": "breakfast", "recipe_id": str(recipe.id), "portion_factor": 0.125}
                ],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 200, response.text
        assert response.json()["items"][0]["portion_factor"] == 0.13
        assert response.json()["totals"]["fat"] == pytest.approx(81.1 * 0.13, abs=0.01)

    async def test_portion_factor_below_storable_step_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """0.004 округлилось бы до нуля: позиция без массы в плане дня."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 100)])

        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [
                    {"meal_slot": "breakfast", "recipe_id": str(recipe.id), "portion_factor": 0.004}
                ],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    async def test_second_save_replaces_items_and_keeps_one_menu_per_date(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        first = await _recipe(session, dietitian, ingredients=[(butter, 50)])
        second = await _recipe(session, dietitian, ingredients=[(chicken, 40)])

        created = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(first.id)}],
            },
            headers=auth_headers(parent),
        )
        dropped_item_id = created.json()["items"][0]["id"]

        updated = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(second.id)}],
            },
            headers=auth_headers(parent),
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["id"] == created.json()["id"], "меню дня одно (unique patient+date)"
        assert [item["recipe_id"] for item in updated.json()["items"]] == [str(second.id)]

        menus = await session.scalar(
            select(func.count()).select_from(Menu).where(Menu.patient_id == patient.id)
        )
        assert menus == 1

        # Правило 4 CLAUDE.md: выпавшая позиция физически не удаляется
        row = await session.scalar(
            select(MenuItem).where(MenuItem.id == uuid.UUID(dropped_item_id))
        )
        assert row is not None
        assert row.deleted_at is not None

    async def test_resaving_day_keeps_eaten_mark_of_unchanged_item(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Семья отмечает съеденное в течение дня и дополняет план вечером.
        Пересохранение дня не должно стирать уже проставленные отметки."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        breakfast = await _recipe(session, dietitian, ingredients=[(butter, 50)])
        dinner = await _recipe(session, dietitian, ingredients=[(chicken, 40)])

        created = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(breakfast.id)}],
            },
            headers=auth_headers(parent),
        )
        breakfast_id = created.json()["items"][0]["id"]

        eaten = await client.post(
            f"{_url(patient)}/items/{breakfast_id}/eaten",
            json={"eaten": True},
            headers=auth_headers(parent),
        )
        assert eaten.status_code == 200, eaten.text

        updated = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [
                    {"meal_slot": "breakfast", "recipe_id": str(breakfast.id)},
                    {"meal_slot": "dinner", "recipe_id": str(dinner.id)},
                ],
            },
            headers=auth_headers(parent),
        )
        items = {item["meal_slot"]: item for item in updated.json()["items"]}
        assert items["breakfast"]["id"] == breakfast_id
        assert items["breakfast"]["eaten"] is True
        assert items["dinner"]["eaten"] is False


class TestValidation:
    @pytest.mark.parametrize(
        "item",
        [
            {"meal_slot": "breakfast"},  # ни рецепта, ни своего блюда
            {"meal_slot": "breakfast", "portion_factor": 0},
            {"meal_slot": "breakfast", "portion_factor": -1},
            {"meal_slot": "second_dinner"},  # нет такого приёма пищи
        ],
    )
    async def test_invalid_item_rejected(
        self, client, session, make_user, make_patient, auth_headers, item
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.put(
            _url(patient),
            json={"date": MENU_DATE, "items": [item]},
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    async def test_both_recipe_and_custom_dish_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Две ссылки — непонятно, что попадает в итоги дня."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])
        dish = await _custom_dish(session, patient, ingredients=[(butter, 20)])

        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [
                    {
                        "meal_slot": "breakfast",
                        "recipe_id": str(recipe.id),
                        "custom_dish_id": str(dish.id),
                    }
                ],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_empty_day_rejected(self, client, session, make_user, make_patient, auth_headers):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.put(
            _url(patient), json={"date": MENU_DATE, "items": []}, headers=auth_headers(parent)
        )
        assert response.status_code == 422

    async def test_unpublished_recipe_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Черновик — незавершённая работа диетолога: его состав ещё не проверен,
        а по меню кормят ребёнка (раздел 5.3 ТЗ)."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        draft = await _recipe(
            session, dietitian, ingredients=[(butter, 50)], status=RecipeStatus.DRAFT
        )

        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(draft.id)}],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422
        assert "опубликованные" in response.json()["error"]["message"]

    async def test_unknown_recipe_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(uuid.uuid4())}],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422

    async def test_custom_dish_of_another_patient_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Иначе в меню ребёнка попало бы блюдо, составленное для другого."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        _, other_patient = await _linked_parent(session, make_user, make_patient)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        foreign_dish = await _custom_dish(session, other_patient, ingredients=[(butter, 30)])

        response = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "custom_dish_id": str(foreign_dish.id)}],
            },
            headers=auth_headers(parent),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"


class TestGet:
    async def test_returns_menu_of_requested_date(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )

        response = await client.get(
            _url(patient), params={"date": MENU_DATE}, headers=auth_headers(parent)
        )
        assert response.status_code == 200, response.text
        assert response.json()["date"] == MENU_DATE
        assert len(response.json()["items"]) == 1

        other_day = await client.get(
            _url(patient), params={"date": "2026-03-03"}, headers=auth_headers(parent)
        )
        assert other_day.status_code == 404

    async def test_withdrawn_product_is_named_but_day_still_reads(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Вывод продукта из оборота не отменяет уже сохранённый день.

        Он убирает продукт из поиска — но не из рецептов и меню, где тот уже
        стоит. Так и должно быть: убрать блюдо из прошлого дня значит подменить
        то, чем ребёнка кормили на самом деле. Молчать об этом нельзя: выводят
        продукт обычно потому, что его числа оказались неверными, а по этим
        числам считаются итоги дня.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50), (chicken, 40)])
        dish = await _custom_dish(session, patient, ingredients=[(chicken, 30)])

        await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [
                    {"meal_slot": "breakfast", "recipe_id": str(recipe.id)},
                    {"meal_slot": "lunch", "custom_dish_id": str(dish.id)},
                ],
            },
            headers=auth_headers(parent),
        )

        clean = await client.get(
            _url(patient), params={"date": MENU_DATE}, headers=auth_headers(parent)
        )
        assert clean.json()["withdrawn_products"] == []

        butter.is_active = False
        await session.flush()

        response = await client.get(
            _url(patient), params={"date": MENU_DATE}, headers=auth_headers(parent)
        )
        assert response.status_code == 200, response.text
        body = response.json()

        # День читается и считается как прежде — запрета нет.
        assert body["totals"] is not None
        assert len(body["items"]) == 2

        withdrawn = body["withdrawn_products"]
        assert [entry["name_ru"] for entry in withdrawn] == [butter.name_ru]

        # Названы и позиции: в дне их несколько, и семья должна знать, какая.
        breakfast = next(i for i in body["items"] if i["meal_slot"] == "breakfast")
        lunch = next(i for i in body["items"] if i["meal_slot"] == "lunch")
        assert withdrawn[0]["item_ids"] == [breakfast["id"]]
        assert lunch["id"] not in withdrawn[0]["item_ids"]

    async def test_date_is_required(self, client, session, make_user, make_patient, auth_headers):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.get(_url(patient), headers=auth_headers(parent))
        assert response.status_code == 422


class TestSnapshotFreezesTheDay:
    """Позиция дня хранит снимок состава.

    Позиция ссылается на рецепт, а тот живёт своей жизнью: диетолог правит
    состав, администратор — числа продукта. Пока снимка не было, правка задним
    числом меняла прошлые дни при первом же их сохранении, и ответить, чем
    ребёнок питался первого мая, было нельзя — при том что запрет удалять
    использованный рецепт обоснован как раз сохранностью истории.
    """

    async def test_recipe_edit_does_not_change_a_saved_day(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        saved = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )
        assert saved.status_code == 200, saved.text
        before = saved.json()["totals"]

        # Диетолог переписывает рецепт целиком.
        session.add(
            RecipeIngredient(recipe_id=recipe.id, product_id=chicken.id, grams=200, position=1)
        )
        await session.flush()

        read = await client.get(
            _url(patient), params={"date": MENU_DATE}, headers=auth_headers(parent)
        )
        assert read.json()["totals"] == before, "правка рецепта не меняет сохранённый день"

        # И повторное сохранение того же дня — тоже: позиция переиспользуется,
        # снимок у неё остаётся прежним.
        again = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )
        assert again.json()["totals"] == before

        # Но об изменении сказано: рецепт правят, когда в нём нашли ошибку, и
        # семье решать, пересобрать день или оставить.
        item = again.json()["items"][0]
        assert item["has_snapshot"] is True
        assert item["changed_since_saved"] is True

    async def test_product_numbers_change_does_not_change_a_saved_day(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Заморожены и значения продуктов на 100 г.

        Без них пересчёт опирался бы на сегодняшние числа — ровно на то, что мы
        замораживаем.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        saved = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )
        before = saved.json()["totals"]

        butter.fat_100g = 60
        butter.kcal_100g = 540
        await session.flush()

        read = await client.get(
            _url(patient), params={"date": MENU_DATE}, headers=auth_headers(parent)
        )
        assert read.json()["totals"] == before
        assert read.json()["items"][0]["changed_since_saved"] is True

    async def test_new_day_uses_the_current_recipe(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Замораживается день, а не рецепт: новый день берёт нынешний состав."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        first = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )

        session.add(
            RecipeIngredient(recipe_id=recipe.id, product_id=chicken.id, grams=200, position=1)
        )
        await session.flush()

        second = await client.put(
            _url(patient),
            json={
                "date": "2026-03-09",
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )

        assert second.json()["totals"]["protein"] > first.json()["totals"]["protein"]
        assert second.json()["items"][0]["changed_since_saved"] is False

    async def test_unchanged_recipe_is_not_reported_as_changed(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )

        read = await client.get(
            _url(patient), params={"date": MENU_DATE}, headers=auth_headers(parent)
        )
        assert read.json()["items"][0]["changed_since_saved"] is False

    async def test_snapshot_keeps_names_for_reading_the_past(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Название продукта — тоже в снимке.

        Продукт могут переименовать, а прочитать состав прошлого дня надо и
        через год.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )

        stored = await session.scalar(select(MenuItem).where(MenuItem.patient_id == patient.id))
        assert stored is not None and stored.snapshot is not None
        assert stored.snapshot["title"] == recipe.title
        assert stored.snapshot["ingredients"][0]["name_ru"] == butter.name_ru
        assert stored.snapshot["ingredients"][0]["fat_100g"] == BUTTER["fat_100g"]


class TestExcludedProductsAreNamed:
    """План дня — то же, что вход расчёта: по нему кормят.

    Раздел 6.3 ТЗ говорит об исключениях на входе решателя, но блюдо с
    исключённым продуктом попадает в день и без него — из рецепта, составленного
    для другого ребёнка.
    """

    async def test_day_with_an_excluded_product_is_marked_but_kept(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )

        patient.allergies = [str(butter.id), "цитрусовые"]
        await session.flush()

        response = await client.get(
            _url(patient), params={"date": MENU_DATE}, headers=auth_headers(parent)
        )
        assert response.status_code == 200, response.text
        body = response.json()

        # День не запрещается и не подменяется: исключения уточняются по ходу
        # терапии, и вчерашний план мог быть согласован с врачом.
        assert body["totals"] is not None
        assert [e["name_ru"] for e in body["excluded_products"]] == [butter.name_ru]
        assert body["excluded_products"][0]["item_ids"] == [body["items"][0]["id"]]

    async def test_free_label_alone_marks_nothing(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """«Орехи» сопоставить с каталогом нечем — в этом и была вся проблема."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )

        patient.allergies = ["масло", "орехи"]
        await session.flush()

        response = await client.get(
            _url(patient), params={"date": MENU_DATE}, headers=auth_headers(parent)
        )
        assert response.json()["excluded_products"] == []


class TestAccessControl:
    async def test_menu_of_other_patient_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        other_child = await make_patient("Чужой")

        read = await client.get(
            _url(other_child), params={"date": MENU_DATE}, headers=auth_headers(parent)
        )
        assert read.status_code == 403

        write = await client.put(
            _url(other_child),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(uuid.uuid4())}],
            },
            headers=auth_headers(parent),
        )
        assert write.status_code == 403

    async def test_item_of_another_patient_not_reachable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Доступ к пациенту не даёт прав на позицию меню другого."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        other_parent, other_patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        created = await client.put(
            _url(other_patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(other_parent),
        )
        foreign_item_id = created.json()["items"][0]["id"]

        response = await client.post(
            f"{_url(patient)}/items/{foreign_item_id}/eaten",
            json={"eaten": True},
            headers=auth_headers(parent),
        )
        assert response.status_code == 404, "чужая позиция не должна быть достижима"


class TestEaten:
    async def test_marks_and_unmarks_without_recomputing_totals(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло сливочное", **BUTTER)
        recipe = await _recipe(session, dietitian, ingredients=[(butter, 50)])

        created = await client.put(
            _url(patient),
            json={
                "date": MENU_DATE,
                "items": [{"meal_slot": "breakfast", "recipe_id": str(recipe.id)}],
            },
            headers=auth_headers(parent),
        )
        item_id = created.json()["items"][0]["id"]
        totals_before = created.json()["totals"]

        marked = await client.post(
            f"{_url(patient)}/items/{item_id}/eaten",
            json={"eaten": True},
            headers=auth_headers(parent),
        )
        assert marked.status_code == 200, marked.text
        assert marked.json()["eaten"] is True

        menu = await client.get(
            _url(patient), params={"date": MENU_DATE}, headers=auth_headers(parent)
        )
        assert menu.json()["totals"] == totals_before, "отметка меняет только флаг позиции"
        assert menu.json()["items"][0]["eaten"] is True

        # Ошибочное нажатие должно сниматься: другой ручки правки позиции нет
        unmarked = await client.post(
            f"{_url(patient)}/items/{item_id}/eaten",
            json={"eaten": False},
            headers=auth_headers(parent),
        )
        assert unmarked.json()["eaten"] is False

    async def test_unknown_item_not_found(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        response = await client.post(
            f"{_url(patient)}/items/{uuid.uuid4()}/eaten",
            json={"eaten": True},
            headers=auth_headers(parent),
        )
        assert response.status_code == 404
