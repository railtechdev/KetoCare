"""Приправы вне расчёта (ADR-0054, ответ клиники на вопрос 16).

«Соль, перец не учитываются в расчётах». Отметка стоит на продукте
(`products.counts_in_calculation`), а проверяется здесь каждая дорога, по
которой продукты превращаются во вход ядра: калькулятор (три ручки), рецепт,
своё блюдо, снимок позиции меню и итог дня. Путь, забывший про отметку, считал
бы перец в соотношение — а соседний нет.

Во всех тестах приправа — чёрный перец с настоящими значениями USDA, а не
соль: у соли все нули, и тест с ней прошёл бы и при дыре.

Потребители формы ответа (правило «стык проверяется у поставщика»):
- `uncounted_items` в `/calc/verify` и `/calc/scale`, `uncounted` в
  `/calc/solve` — калькулятор кабинета (`apps/web/src/features/calculator/
  CalculatorPage.tsx`), форма рецепта (`apps/web/src/features/recipes/
  useRecipeComputed.ts`) и калькулятор Mini App (`apps/miniapp/src/features/
  calculator/CalculatorScreen.tsx`);
- `counts_in_calculation` у строки состава позиции меню — список «что
  взвесить» в кабинете (`apps/web/src/features/menu`) и в Mini App
  (`apps/miniapp/src/features/menu`);
- `counts_in_calculation` у продукта — форма продукта кабинета.
Бот составов с показателями не показывает и формы этих полей не читает.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select, update

from core.models import AuditLog, MenuItem, Product, ProductCategory, Recipe, RecipeIngredient
from core.models.enums import RecipeCategory, RecipeStatus, UserRole
from core.repositories import patients as patients_repo
from core.repositories import products as products_repo

pytestmark = pytest.mark.asyncio

BUTTER = dict(kcal_100g=717, fat_100g=81.1, protein_100g=0.9, carbs_100g=0.1, fiber_100g=0.0)
CHICKEN = dict(kcal_100g=165, fat_100g=3.6, protein_100g=31.0, carbs_100g=0.0, fiber_100g=0.0)
# USDA SR Legacy, «Spices, pepper, black» (fdc 170931).
PEPPER = dict(kcal_100g=251, fat_100g=3.26, protein_100g=10.39, carbs_100g=63.95, fiber_100g=25.3)

MENU_DATE = "2026-03-02"


async def _category(session) -> ProductCategory:
    category = await session.scalar(select(ProductCategory).limit(1))
    if category is None:
        category = ProductCategory(name_ru="Тестовая", sort=0)
        session.add(category)
        await session.flush()
    return category


async def _product(session, name: str, *, counts: bool = True, **macros) -> Product:
    category = await _category(session)
    product = Product(
        name_ru=f"{name} {uuid.uuid4().hex[:8]}",
        category_id=category.id,
        source="USDA",
        source_version="SR Legacy",
        verified_at=date(2026, 1, 1),
        counts_in_calculation=counts,
        **macros,
    )
    session.add(product)
    await session.flush()
    return product


def _ingredient(product: Product) -> dict:
    return {
        "product_id": str(product.id),
        "kcal": float(product.kcal_100g),
        "fat": float(product.fat_100g),
        "protein": float(product.protein_100g),
        "carbs": float(product.carbs_100g),
        "fiber": float(product.fiber_100g),
    }


async def _linked_parent(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


def _numbers(computed: dict) -> dict:
    """Показатели без перечня невошедших позиций — то, что считает ядро."""

    return {key: value for key, value in computed.items() if key != "uncounted_product_ids"}


async def _verify(client, headers, items: list[tuple[Product, float]], **extra) -> dict:
    response = await client.post(
        "/api/v1/calc/verify",
        json={
            "ingredients": [_ingredient(product) for product, _ in items],
            "items": [{"product_id": str(product.id), "grams": grams} for product, grams in items],
            **extra,
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


class TestProductFlag:
    def _payload(self, category_id, **overrides) -> dict:
        payload = {
            "name_ru": f"Перец чёрный {uuid.uuid4().hex[:8]}",
            "category_id": str(category_id),
            **{key: value for key, value in PEPPER.items()},
            "source": "USDA",
            "source_version": "SR Legacy",
            "verified_at": "2026-01-01",
        }
        payload.update(overrides)
        return payload

    async def test_new_product_counts_by_default(self, client, session, make_user, auth_headers):
        """Какие продукты приправы, решает диетолог, а не умолчание."""

        dietitian = await make_user(UserRole.DIETITIAN)
        category = await _category(session)

        response = await client.post(
            "/api/v1/products", json=self._payload(category.id), headers=auth_headers(dietitian)
        )

        assert response.status_code == 201, response.text
        assert response.json()["counts_in_calculation"] is True

    async def test_dietitian_marks_seasoning_with_revision_and_audit(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        category = await _category(session)
        created = await client.post(
            "/api/v1/products", json=self._payload(category.id), headers=auth_headers(dietitian)
        )
        product_id = created.json()["id"]

        response = await client.put(
            f"/api/v1/products/{product_id}",
            json=self._payload(
                category.id, name_ru=created.json()["name_ru"], counts_in_calculation=False
            ),
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 200, response.text
        assert response.json()["counts_in_calculation"] is False

        revisions = await products_repo.list_revisions(session, product_id=product_id)
        assert revisions[0].snapshot["counts_in_calculation"] is False

        audit = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "products",
                AuditLog.entity_id == uuid.UUID(product_id),
                AuditLog.action == "update",
            )
        )
        assert audit is not None
        assert audit.before["counts_in_calculation"] is True
        assert audit.after["counts_in_calculation"] is False

    async def test_family_cannot_mark_a_seasoning(self, client, session, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)
        pepper = await _product(session, "Перец", **PEPPER)
        category = await _category(session)

        response = await client.put(
            f"/api/v1/products/{pepper.id}",
            json=self._payload(category.id, name_ru=pepper.name_ru, counts_in_calculation=False),
            headers=auth_headers(parent),
        )

        assert response.status_code == 403
        await session.refresh(pepper)
        assert pepper.counts_in_calculation is True

    async def test_flag_must_be_a_boolean(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        category = await _category(session)

        response = await client.post(
            "/api/v1/products",
            json=self._payload(category.id, counts_in_calculation="может быть"),
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 422


class TestImportColumn:
    HEADER = (
        "name_ru,category,kcal_100g,fat_100g,protein_100g,carbs_100g,fiber_100g,"
        "source,source_version,verified_at,counts_in_calculation"
    )

    def _file(self, *rows: str, header: str | None = None) -> dict:
        content = ("\n".join([header or self.HEADER, *rows]) + "\n").encode("utf-8")
        return {"file": ("products.csv", content, "text/csv")}

    async def test_no_marks_seasoning_and_empty_counts(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        suffix = uuid.uuid4().hex[:8]

        response = await client.post(
            "/api/v1/products/import",
            files=self._file(
                f"Перец {suffix},Приправы,251,3.26,10.39,63.95,25.3,USDA,SR Legacy,2026-01-01,нет",
                f"Масло {suffix},Жиры,748,82.5,0.5,0.8,0,USDA,SR Legacy,2026-01-01,",
            ),
            params={"dry_run": "false"},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200, response.text
        assert response.json()["imported"] == 2
        flags = dict(
            (
                await session.execute(
                    select(Product.name_ru, Product.counts_in_calculation).where(
                        Product.name_ru.in_([f"Перец {suffix}", f"Масло {suffix}"])
                    )
                )
            ).all()
        )
        assert flags == {f"Перец {suffix}": False, f"Масло {suffix}": True}

    async def test_unknown_word_is_a_cell_error(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)

        response = await client.post(
            "/api/v1/products/import",
            files=self._file(
                f"Перец {uuid.uuid4().hex[:8]},Приправы,251,3.26,10.39,63.95,25.3,"
                "USDA,SR Legacy,2026-01-01,наверное"
            ),
            headers=auth_headers(admin),
        )

        assert response.status_code == 200, response.text
        errors = response.json()["errors"]
        assert [error["column"] for error in errors] == ["counts_in_calculation"]

    async def test_updating_import_without_the_column_keeps_the_mark(
        self, client, session, make_user, auth_headers
    ):
        """Файл старого образца не возвращает приправу в расчёт молча."""

        admin = await make_user(UserRole.ADMIN)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)
        old_header = self.HEADER.removesuffix(",counts_in_calculation")

        response = await client.post(
            "/api/v1/products/import",
            files=self._file(
                f"{pepper.name_ru},Приправы,251,3.26,10.39,63.95,25.3,USDA,SR Legacy 2,2026-02-01",
                header=old_header,
            ),
            params={"dry_run": "false", "update_existing": "true"},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200, response.text
        assert response.json()["updated"] == 1
        await session.refresh(pepper)
        assert pepper.counts_in_calculation is False

    async def test_updating_import_shows_the_mark_change_in_words(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        pepper = await _product(session, "Перец", **PEPPER)

        response = await client.post(
            "/api/v1/products/import",
            files=self._file(
                f"{pepper.name_ru},Тестовая,251,3.26,10.39,63.95,25.3,USDA,SR Legacy,2026-01-01,нет"
            ),
            params={"update_existing": "true"},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200, response.text
        [change] = response.json()["updates"][0]["changes"]
        assert change == {"field": "counts_in_calculation", "before": "да", "after": "нет"}


class TestCalc:
    async def test_verify_leaves_seasoning_out_of_every_number(
        self, client, session, make_user, auth_headers
    ):
        user = await make_user(UserRole.PARENT)
        butter = await _product(session, "Масло", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)
        headers = auth_headers(user)

        with_pepper = await _verify(client, headers, [(butter, 40), (chicken, 30), (pepper, 2)])
        without = await _verify(client, headers, [(butter, 40), (chicken, 30)])

        assert with_pepper["dish"] == without["dish"]
        assert [item["product_id"] for item in with_pepper["dish"]["items"]] == [
            str(butter.id),
            str(chicken.id),
        ]
        assert with_pepper["uncounted_items"] == [
            {"product_id": str(pepper.id), "name_ru": pepper.name_ru, "grams": 2.0}
        ]
        assert without["uncounted_items"] == []

    async def test_the_mark_comes_from_the_catalog_not_the_request(
        self, client, session, make_user, auth_headers
    ):
        """Тот же перец без отметки считается: клиент отметку не передаёт."""

        user = await make_user(UserRole.PARENT)
        butter = await _product(session, "Масло", **BUTTER)
        pepper = await _product(session, "Перец", **PEPPER)

        body = await _verify(client, auth_headers(user), [(butter, 40), (pepper, 2)])

        assert body["uncounted_items"] == []
        assert str(pepper.id) in {item["product_id"] for item in body["dish"]["items"]}

    async def test_carbs_limit_ignores_seasoning(self, client, session, make_user, auth_headers):
        """10 г перца — 6,4 г углеводов: без отметки лимит в 5 г был бы превышен."""

        user = await make_user(UserRole.PARENT)
        butter = await _product(session, "Масло", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)

        body = await _verify(
            client,
            auth_headers(user),
            [(butter, 40), (chicken, 30), (pepper, 10)],
            targets={"ratio": 3.0, "kcal": 400, "carbs_max_g": 5},
        )

        assert body["dish"]["carbs_g"] == pytest.approx(0.04, abs=0.001)

    async def test_excluded_seasoning_is_still_reported(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Аллергия на приправу — такая же аллергия: вне расчёта не значит вне проверки."""

        parent, patient = await _linked_parent(session, make_user, make_patient)
        butter = await _product(session, "Масло", **BUTTER)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)
        patient.allergies = [str(pepper.id)]
        await session.flush()

        body = await _verify(
            client,
            auth_headers(parent),
            [(butter, 40), (pepper, 2)],
            patient_id=str(patient.id),
        )

        assert [entry["product_id"] for entry in body["excluded"]] == [str(pepper.id)]

    async def test_solve_does_not_pick_grams_of_seasoning(
        self, client, session, make_user, auth_headers
    ):
        user = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [_ingredient(butter), _ingredient(chicken), _ingredient(pepper)],
                "targets": {"ratio": 3.0, "kcal": 400},
            },
            headers=auth_headers(user),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert str(pepper.id) not in {item["product_id"] for item in body["dish"]["items"]}
        assert body["uncounted"] == [{"product_id": str(pepper.id), "name_ru": pepper.name_ru}]

    async def test_solve_of_seasonings_only_explains_itself(
        self, client, session, make_user, auth_headers
    ):
        user = await make_user(UserRole.DIETITIAN)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)

        response = await client.post(
            "/api/v1/calc/solve",
            json={"ingredients": [_ingredient(pepper)], "targets": {"ratio": 3.0, "kcal": 400}},
            headers=auth_headers(user),
        )

        assert response.status_code == 422, response.text
        error = response.json()["error"]
        assert error["code"] == "validation_error"
        assert "приправы" in error["message"]

    async def test_scale_scales_seasoning_grams_outside_the_engine(
        self, client, session, make_user, auth_headers
    ):
        user = await make_user(UserRole.PARENT)
        butter = await _product(session, "Масло", **BUTTER)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)

        response = await client.post(
            "/api/v1/calc/scale",
            json={
                "ingredients": [_ingredient(butter), _ingredient(pepper)],
                "items": [
                    {"product_id": str(butter.id), "grams": 40},
                    {"product_id": str(pepper.id), "grams": 1.5},
                ],
                "factor": 2,
            },
            headers=auth_headers(user),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert [item["product_id"] for item in body["dish"]["items"]] == [str(butter.id)]
        assert body["dish"]["carbs_g"] == pytest.approx(0.08, abs=0.001)
        assert body["uncounted_items"] == [
            {"product_id": str(pepper.id), "name_ru": pepper.name_ru, "grams": 3.0}
        ]


class TestStoredCompositions:
    async def test_recipe_computed_ignores_seasoning(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)

        async def create(*parts: tuple[Product, float]) -> dict:
            response = await client.post(
                "/api/v1/recipes",
                json={
                    "title": f"Курица с маслом {uuid.uuid4().hex[:6]}",
                    "category": "lunch",
                    "yield_g": 100,
                    "servings": 1,
                    "instructions": "Запечь.",
                    "ingredients": [
                        {"product_id": str(product.id), "grams": grams} for product, grams in parts
                    ],
                },
                headers=auth_headers(dietitian),
            )
            assert response.status_code == 201, response.text
            return response.json()

        with_pepper = await create((butter, 40), (chicken, 60), (pepper, 3))
        without = await create((butter, 40), (chicken, 60))

        assert _numbers(with_pepper["computed"]) == _numbers(without["computed"])
        # Какие позиции не вошли в числа — рядом с самими числами: по этому
        # списку карточка рецепта ставит пометку, а не по живой отметке.
        assert with_pepper["computed"]["uncounted_product_ids"] == [str(pepper.id)]
        assert without["computed"]["uncounted_product_ids"] == []
        # Приправа остаётся в составе рецепта: по нему готовят.
        assert str(pepper.id) in {row["product_id"] for row in with_pepper["ingredients"]}

    async def test_custom_dish_computed_ignores_seasoning(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        butter = await _product(session, "Масло", **BUTTER)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)

        async def create(*parts: tuple[Product, float]) -> dict:
            response = await client.post(
                f"/api/v1/patients/{patient.id}/custom-dishes",
                json={
                    "title": "Блюдо",
                    "ingredients": [
                        {"product_id": str(product.id), "grams": grams} for product, grams in parts
                    ],
                },
                headers=auth_headers(parent),
            )
            assert response.status_code == 201, response.text
            return response.json()

        with_pepper = await create((butter, 40), (pepper, 5))
        without = await create((butter, 40))

        assert _numbers(with_pepper["computed"]) == _numbers(without["computed"])
        assert with_pepper["computed"]["uncounted_product_ids"] == [str(pepper.id)]

    async def test_saved_recipe_describes_its_own_numbers_not_the_live_mark(
        self, client, session, make_user, auth_headers
    ):
        """Отметку поставили после расчёта — карточка не приписывает её числам.

        Сохранённый расчёт задним числом не пересчитывается, и пометка «не в
        расчёте» по живой отметке стояла бы рядом с числами, где перец учтён.
        """

        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло", **BUTTER)
        pepper = await _product(session, "Перец", **PEPPER)
        created = await client.post(
            "/api/v1/recipes",
            json={
                "title": f"Масло с перцем {uuid.uuid4().hex[:6]}",
                "category": "lunch",
                "yield_g": 50,
                "servings": 1,
                "instructions": "Смешать.",
                "ingredients": [
                    {"product_id": str(butter.id), "grams": 40},
                    {"product_id": str(pepper.id), "grams": 3},
                ],
            },
            headers=auth_headers(dietitian),
        )
        assert created.status_code == 201, created.text

        pepper.counts_in_calculation = False
        await session.flush()

        reread = await client.get(
            f"/api/v1/recipes/{created.json()['id']}", headers=auth_headers(dietitian)
        )
        assert reread.status_code == 200, reread.text
        assert reread.json()["computed"] == created.json()["computed"]
        assert reread.json()["computed"]["uncounted_product_ids"] == []


class TestMenuDay:
    async def _recipe(self, session, author, parts: list[tuple[Product, float]], servings=1):
        recipe = Recipe(
            title=f"Рецепт {uuid.uuid4().hex[:8]}",
            category=RecipeCategory.LUNCH,
            yield_g=100,
            servings=servings,
            instructions="Запечь",
            status=RecipeStatus.PUBLISHED,
            author_id=author.id,
        )
        session.add(recipe)
        await session.flush()
        for position, (product, grams) in enumerate(parts):
            session.add(
                RecipeIngredient(
                    recipe_id=recipe.id, product_id=product.id, grams=grams, position=position
                )
            )
        await session.flush()
        return recipe

    async def _save_day(self, client, headers, patient, *recipes: Recipe) -> dict:
        response = await client.put(
            f"/api/v1/patients/{patient.id}/menus",
            json={
                "date": MENU_DATE,
                "items": [
                    {"meal_index": index + 1, "recipe_id": str(recipe.id), "portion_factor": 1}
                    for index, recipe in enumerate(recipes)
                ],
            },
            headers=headers,
        )
        assert response.status_code == 200, response.text
        return response.json()

    async def test_day_totals_ignore_seasoning_and_the_weighing_list_keeps_it(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло", **BUTTER)
        chicken = await _product(session, "Курица", **CHICKEN)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)
        with_pepper = await self._recipe(
            session, dietitian, [(butter, 40), (chicken, 60), (pepper, 4)], servings=2
        )
        plain = await self._recipe(session, dietitian, [(butter, 40), (chicken, 60)], servings=2)

        day = await self._save_day(client, auth_headers(parent), patient, with_pepper)
        totals_with_pepper = day["totals"]
        reference = await self._save_day(client, auth_headers(parent), patient, plain)

        assert totals_with_pepper == reference["totals"]

        day = await self._save_day(client, auth_headers(parent), patient, with_pepper)
        weighing = {row["product_id"]: row for row in day["items"][0]["ingredients"]}
        # Граммы на позицию (рецепт на две порции, одна порция) — и для приправы.
        assert weighing[str(pepper.id)]["grams"] == pytest.approx(2.0)
        assert weighing[str(pepper.id)]["counts_in_calculation"] is False
        assert weighing[str(butter.id)]["counts_in_calculation"] is True

    async def test_saved_day_does_not_change_when_the_mark_does(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Отметка замораживается в снимке, как и числа продукта (ADR-0016).

        Перечитанный день считает так же, как в день сохранения, но говорит,
        что блюдо с тех пор изменилось.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло", **BUTTER)
        pepper = await _product(session, "Перец", counts=False, **PEPPER)
        recipe = await self._recipe(session, dietitian, [(butter, 40), (pepper, 4)])

        saved = await self._save_day(client, auth_headers(parent), patient, recipe)
        assert saved["items"][0]["changed_since_saved"] is False

        pepper.counts_in_calculation = True
        await session.flush()

        reread = await client.get(
            f"/api/v1/patients/{patient.id}/menus",
            params={"date": MENU_DATE},
            headers=auth_headers(parent),
        )
        assert reread.status_code == 200, reread.text
        body = reread.json()
        assert body["totals"] == saved["totals"]
        assert body["items"][0]["changed_since_saved"] is True

    async def test_snapshots_saved_before_the_mark_count_everything(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Снимок без ключа отметки — сохранённый до неё — считается целиком.

        Так его и считали в день сохранения; иначе прошлые дни поменялись бы
        задним числом. Проверяется пересохранением дня: итог дня считается
        заново по снимку переиспользованной позиции.
        """

        parent, patient = await _linked_parent(session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        butter = await _product(session, "Масло", **BUTTER)
        pepper = await _product(session, "Перец", **PEPPER)
        recipe = await self._recipe(session, dietitian, [(butter, 40), (pepper, 4)])

        saved = await self._save_day(client, auth_headers(parent), patient, recipe)
        item = await session.get(MenuItem, uuid.UUID(saved["items"][0]["id"]))
        assert item is not None
        legacy = dict(item.snapshot)
        legacy["ingredients"] = [
            {key: value for key, value in row.items() if key != "counts_in_calculation"}
            for row in legacy["ingredients"]
        ]
        await session.execute(
            update(MenuItem).where(MenuItem.id == item.id).values(snapshot=legacy)
        )
        await session.refresh(item)
        # Перец с тех пор отметили приправой — снимок старого дня это не меняет.
        pepper.counts_in_calculation = False
        await session.flush()

        resaved = await self._save_day(client, auth_headers(parent), patient, recipe)

        assert resaved["totals"] == saved["totals"]
        assert all(row["counts_in_calculation"] for row in resaved["items"][0]["ingredients"])
