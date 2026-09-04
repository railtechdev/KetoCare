"""Импорт рецептов из CSV (раздел 15 п. 24 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date

import pytest

from api.services.recipe_import import parse_csv
from core.models import Product, ProductCategory, Recipe
from core.models.enums import RecipeStatus, UserRole

# Разбор файла — чистая функция, база ему не нужна; отметка `asyncio` стоит
# только на классе с ручкой.
pytestmark: list = []

HEADER = "title,category,yield_g,servings,instructions,product_name,grams"


def _csv(*rows: str) -> bytes:
    return ("\n".join((HEADER, *rows)) + "\n").encode("utf-8")


async def _product(session, name: str) -> Product:
    category = ProductCategory(name_ru=f"Категория {uuid.uuid4().hex[:6]}", sort=0)
    session.add(category)
    await session.flush()
    product = Product(
        name_ru=name,
        category_id=category.id,
        kcal_100g=717,
        fat_100g=81.1,
        protein_100g=0.9,
        carbs_100g=0.1,
        fiber_100g=0.0,
        source="USDA",
        source_version="SR28",
        verified_at=date(2026, 1, 1),
    )
    session.add(product)
    await session.flush()
    return product


class TestParsing:
    def test_a_repeated_title_continues_the_recipe(self):
        """Так в таблице пишут чаще, чем оставляют ячейку пустой."""

        report = parse_csv(
            _csv(
                'Омлет,breakfast,120,1,"1. Растопите.",Масло,30',
                "Омлет,,,,,Яйцо,55",
            )
        )

        assert report.ok, report.errors
        assert len(report.recipes) == 1
        assert [item.product_name for item in report.recipes[0].ingredients] == ["Масло", "Яйцо"]

    def test_an_empty_title_continues_too(self):
        report = parse_csv(
            _csv(
                'Омлет,breakfast,120,1,"1. Растопите.",Масло,30',
                ",,,,,Яйцо,55",
            )
        )

        assert report.ok, report.errors
        assert len(report.recipes[0].ingredients) == 2

    def test_the_same_title_with_a_second_header_is_an_error(self):
        """Два разных рецепта под одним именем — ошибка, а не продолжение."""

        report = parse_csv(
            _csv(
                'Омлет,breakfast,120,1,"1. Растопите.",Масло,30',
                'Омлет,lunch,200,2,"1. Иначе.",Яйцо,55',
            )
        )

        assert not report.ok
        assert any("второй раз" in error.message for error in report.errors)

    def test_composition_before_the_first_header_is_an_error(self):
        report = parse_csv(_csv(",,,,,Масло,30"))

        assert not report.ok
        assert any("раньше первого рецепта" in error.message for error in report.errors)

    def test_all_errors_come_at_once(self):
        """Файл правят за один заход, а не за двадцать прогонов."""

        report = parse_csv(
            _csv(
                "Первый,еда,0,0,,Масло,-5",
                'Второй,breakfast,120,1,"1. Шаг.",,0',
            )
        )

        columns = {error.column for error in report.errors}
        assert {"category", "yield_g", "servings", "instructions", "grams"} <= columns

    def test_a_too_long_title_is_a_row_error(self):
        """Иначе строка проходит превью чисто и роняет вставку пятисоткой:
        в таблице `title` — varchar(255)."""

        long_title = "О" * 300
        report = parse_csv(_csv(f'{long_title},breakfast,120,1,"1. Шаг.",Масло,30'))

        assert not report.ok
        assert any(error.column == "title" for error in report.errors)

    def test_limits_are_the_same_as_in_the_form(self):
        """Второй вход в те же таблицы обязан иметь те же пределы.

        Проверяется не значение, а совпадение: собственные копии в первой версии
        этого модуля уже разошлись с формой — выход блюда ограничивался двадцатью
        килограммами против ста, порций было пятьдесят против ста.
        """

        from api.schemas_recipes import RecipeIngredientIn, RecipeWrite
        from api.services import recipe_import

        def bound(model, field, name):
            return next(
                getattr(meta, name)
                for meta in model.model_fields[field].metadata
                if getattr(meta, name, None) is not None
            )

        assert bound(RecipeWrite, "yield_g", "le") == recipe_import.YIELD_MAX
        assert bound(RecipeWrite, "servings", "le") == recipe_import.MAX_SERVINGS
        assert bound(RecipeWrite, "title", "max_length") == recipe_import.TITLE_MAX
        assert bound(RecipeIngredientIn, "grams", "le") == recipe_import.GRAMS_MAX

    def test_a_broken_header_does_not_attach_rows_to_the_previous_recipe(self):
        """Иначе в превью появятся чужие граммы с посчитанными по ним ккал."""

        report = parse_csv(
            _csv(
                'Первый,breakfast,120,1,"1. Шаг.",Масло,30',
                "Второй,,,,,Яйцо,55",
                ",,,,,Сливки,20",
            )
        )

        # «Второй» с пустой шапкой — это продолжение по правилу, но такого
        # рецепта ещё нет: строка становится ошибкой, а не составом «Первого».
        assert len(report.recipes) == 1
        assert [item.product_name for item in report.recipes[0].ingredients] == ["Масло"]

    def test_a_duplicated_product_in_one_recipe_is_an_error(self):
        """Иначе один продукт сложился бы дважды, и расчёт разошёлся бы с составом."""

        report = parse_csv(
            _csv(
                'Омлет,breakfast,120,1,"1. Шаг.",Масло,30',
                "Омлет,,,,,масло,20",
            )
        )

        assert not report.ok
        assert any("повторяется" in error.message for error in report.errors)


@pytest.mark.asyncio
class TestEndpoint:
    async def test_dry_run_shows_what_the_engine_counted(
        self, client, session, make_user, auth_headers
    ):
        """Превью показывает калорийность и соотношение — это и есть проверка
        файла по существу: состав, давший 0,4 : 1 вместо 4 : 1, виден до записи."""

        dietitian = await make_user(UserRole.DIETITIAN)
        await _product(session, "Масло импортное")

        response = await client.post(
            "/api/v1/recipes/import",
            files={
                "file": (
                    "recipes.csv",
                    _csv('Омлет,breakfast,120,1,"1. Растопите.",Масло импортное,30'),
                    "text/csv",
                )
            },
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["dry_run"] is True
        assert body["imported"] == 1
        assert body["recipes"][0]["kcal"] > 0
        assert body["recipes"][0]["ratio"] is not None

    async def test_commit_creates_a_draft(self, client, session, make_user, auth_headers):
        """Заводится черновиком: публикация — отдельное решение (раздел 5.3 ТЗ)."""

        dietitian = await make_user(UserRole.DIETITIAN)
        await _product(session, "Масло импортное")

        response = await client.post(
            "/api/v1/recipes/import?dry_run=false",
            files={
                "file": (
                    "recipes.csv",
                    _csv('Омлет импортный,breakfast,120,1,"1. Растопите.",Масло импортное,30'),
                    "text/csv",
                )
            },
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 200, response.text
        assert response.json()["imported"] == 1

        from sqlalchemy import select

        recipe = await session.scalar(select(Recipe).where(Recipe.title == "Омлет импортный"))
        assert recipe is not None
        assert recipe.status is RecipeStatus.DRAFT
        assert recipe.computed is not None
        assert recipe.engine_version

    async def test_an_unknown_product_stops_the_row(self, client, session, make_user, auth_headers):
        """Рецепт с выдуманным продуктом посчитается, и число будет неверным."""

        dietitian = await make_user(UserRole.DIETITIAN)

        response = await client.post(
            "/api/v1/recipes/import",
            files={
                "file": (
                    "recipes.csv",
                    _csv('Омлет,breakfast,120,1,"1. Шаг.",Несуществующий продукт,30'),
                    "text/csv",
                )
            },
            headers=auth_headers(dietitian),
        )

        body = response.json()
        assert body["imported"] == 0
        assert any("нет в справочнике" in error["message"] for error in body["errors"])

    async def test_an_existing_recipe_is_not_overwritten(
        self, client, session, make_user, auth_headers
    ):
        """У рецепта бывают фото, статус публикации и правки диетолога."""

        dietitian = await make_user(UserRole.DIETITIAN)
        product = await _product(session, "Масло импортное")
        session.add(
            Recipe(
                title="Уже есть",
                category="breakfast",
                yield_g=100,
                servings=1,
                instructions="1. Шаг.",
                author_id=dietitian.id,
                status=RecipeStatus.PUBLISHED,
            )
        )
        await session.flush()
        assert product is not None

        response = await client.post(
            "/api/v1/recipes/import?dry_run=false",
            files={
                "file": (
                    "recipes.csv",
                    _csv('Уже есть,breakfast,120,1,"1. Другое.",Масло импортное,30'),
                    "text/csv",
                )
            },
            headers=auth_headers(dietitian),
        )

        body = response.json()
        assert body["imported"] == 0
        assert any("уже есть" in error["message"] for error in body["errors"])

    async def test_import_is_written_to_the_audit_log(
        self, client, session, make_user, auth_headers
    ):
        """Правка справочника рецептов — из списка раздела 4.2 (правило 7)."""

        from sqlalchemy import select

        from core.models import AuditLog

        dietitian = await make_user(UserRole.DIETITIAN)
        await _product(session, "Масло для аудита")

        await client.post(
            "/api/v1/recipes/import?dry_run=false",
            files={
                "file": (
                    "recipes.csv",
                    _csv('Рецепт для аудита,breakfast,120,1,"1. Шаг.",Масло для аудита,30'),
                    "text/csv",
                )
            },
            headers=auth_headers(dietitian),
        )

        entry = await session.scalar(
            select(AuditLog).where(AuditLog.entity == "recipes", AuditLog.action == "import")
        )
        assert entry is not None
        assert entry.user_id == dietitian.id

    async def test_an_inactive_product_is_not_taken_into_a_new_recipe(
        self, client, session, make_user, auth_headers
    ):
        """Позицию вывели из справочника осознанно — новый рецепт на ней
        означал бы, что решение отменили молча."""

        dietitian = await make_user(UserRole.DIETITIAN)
        product = await _product(session, "Масло выведенное")
        product.is_active = False
        await session.flush()

        response = await client.post(
            "/api/v1/recipes/import",
            files={
                "file": (
                    "recipes.csv",
                    _csv('Омлет,breakfast,120,1,"1. Шаг.",Масло выведенное,30'),
                    "text/csv",
                )
            },
            headers=auth_headers(dietitian),
        )

        body = response.json()
        assert body["imported"] == 0
        assert any("выведен из справочника" in error["message"] for error in body["errors"])

    async def test_parent_may_not_import(self, client, session, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/recipes/import",
            files={"file": ("recipes.csv", _csv(), "text/csv")},
            headers=auth_headers(parent),
        )

        assert response.status_code == 403
