"""Репозиторий рецептов и их состава (раздел 4.2, 5.3 ТЗ).

`computed`/`engine_version` репозиторий только сохраняет — считает их
исключительно расчётное ядро (правило 2 CLAUDE.md).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import ColumnElement, Float, cast, func, select
from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MenuItem, Recipe, RecipeIngredient
from ..models.enums import RecipeCategory, RecipeStatus


def _ratio_column() -> ColumnElement[float]:
    """Кетосоотношение из `computed` как число.

    У рецепта без расчёта (черновик без состава) `computed` пуст, а у состава без
    белков и углеводов `ratio` равен json-null — в обоих случаях выражение даёт
    SQL NULL, и такой рецепт не проходит фильтр по ratio. Это осознанно: под
    диапазон соотношения нельзя подставлять рецепты, соотношение которых неизвестно.
    """

    return cast(Recipe.computed.op("->>")("ratio"), Float)


async def get(session: AsyncSession, recipe_id: uuid.UUID) -> Recipe | None:
    return await session.get(Recipe, recipe_id)


async def search(
    session: AsyncSession,
    *,
    statuses: Sequence[RecipeStatus] | None = None,
    category: RecipeCategory | None = None,
    ratio_min: float | None = None,
    ratio_max: float | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Recipe], int]:
    """Поиск рецептов. `q` — полнотекст по title (GIN-индекс `ix_recipes_title_fts`).

    `statuses=None` — без ограничения по статусу; сужение видимости решает
    вызывающая сторона (родителю доступны только опубликованные, раздел 5.3 ТЗ).
    """

    conditions: list[ColumnElement[bool]] = []
    if statuses is not None:
        conditions.append(Recipe.status.in_(list(statuses)))
    if category is not None:
        conditions.append(Recipe.category == category)
    if ratio_min is not None:
        conditions.append(_ratio_column() >= ratio_min)
    if ratio_max is not None:
        conditions.append(_ratio_column() <= ratio_max)
    if q:
        conditions.append(
            func.to_tsvector("russian", Recipe.title).op("@@")(func.plainto_tsquery("russian", q))
        )

    stmt = (
        select(Recipe)
        .where(*conditions)
        # Вторичная сортировка по id: без неё рецепты с одинаковым названием могут
        # переставляться между страницами, и часть из них не покажется вовсе.
        .order_by(Recipe.title, Recipe.id)
        .limit(limit)
        .offset(offset)
    )
    items = list(await session.scalars(stmt))

    total = await session.scalar(select(func.count()).select_from(Recipe).where(*conditions))
    return items, int(total or 0)


async def list_ingredients(
    session: AsyncSession, *, recipe_id: uuid.UUID
) -> list[RecipeIngredient]:
    stmt = (
        select(RecipeIngredient)
        .where(RecipeIngredient.recipe_id == recipe_id)
        .order_by(RecipeIngredient.position)
    )
    return list(await session.scalars(stmt))


async def ingredients_by_recipe(
    session: AsyncSession, *, recipe_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[RecipeIngredient]]:
    """Состав сразу для страницы рецептов — одним запросом вместо запроса на рецепт."""

    if not recipe_ids:
        return {}

    stmt = (
        select(RecipeIngredient)
        .where(RecipeIngredient.recipe_id.in_(list(recipe_ids)))
        .order_by(RecipeIngredient.recipe_id, RecipeIngredient.position)
    )
    grouped: dict[uuid.UUID, list[RecipeIngredient]] = {rid: [] for rid in recipe_ids}
    for row in await session.scalars(stmt):
        grouped.setdefault(row.recipe_id, []).append(row)
    return grouped


async def create(
    session: AsyncSession,
    *,
    title: str,
    category: RecipeCategory,
    photo_path: str | None,
    yield_g: float,
    servings: int,
    instructions: str,
    author_id: uuid.UUID,
    ingredients: Sequence[tuple[uuid.UUID, float]],
    computed: dict[str, Any] | None,
    engine_version: str | None,
) -> Recipe:
    """Создаёт рецепт в статусе `draft`: публикация — отдельное действие (раздел 5.3 ТЗ)."""

    recipe = Recipe(
        title=title,
        category=category,
        photo_path=photo_path,
        yield_g=yield_g,
        servings=servings,
        instructions=instructions,
        status=RecipeStatus.DRAFT,
        computed=computed,
        engine_version=engine_version,
        author_id=author_id,
    )
    session.add(recipe)
    await session.flush()
    await _replace_ingredients(session, recipe_id=recipe.id, ingredients=ingredients)
    return recipe


async def update(
    session: AsyncSession,
    *,
    recipe: Recipe,
    title: str,
    category: RecipeCategory,
    photo_path: str | None,
    yield_g: float,
    servings: int,
    instructions: str,
    ingredients: Sequence[tuple[uuid.UUID, float]],
    computed: dict[str, Any] | None,
    engine_version: str | None,
) -> Recipe:
    """Статус не трогает: перевод в `published` возможен только через publish."""

    recipe.title = title
    recipe.category = category
    recipe.photo_path = photo_path
    recipe.yield_g = yield_g
    recipe.servings = servings
    recipe.instructions = instructions
    recipe.computed = computed
    recipe.engine_version = engine_version
    await _replace_ingredients(session, recipe_id=recipe.id, ingredients=ingredients)
    return recipe


async def publish(
    session: AsyncSession, *, recipe: Recipe, computed: dict[str, Any], engine_version: str
) -> Recipe:
    """Фиксирует расчёт вместе с версией ядра (раздел 4.1 ТЗ) и открывает рецепт семьям."""

    recipe.computed = computed
    recipe.engine_version = engine_version
    recipe.status = RecipeStatus.PUBLISHED
    await session.flush()
    return recipe


async def unpublish(session: AsyncSession, *, recipe: Recipe) -> Recipe:
    """Возвращает рецепт в черновики: семьям он больше не виден.

    Сохранённые `computed` и `engine_version` не стираются: по ним считались
    дни, и обнулить их значило бы потерять то, чем эти дни объясняются.
    Публикация пересчитает их заново.
    """

    recipe.status = RecipeStatus.DRAFT
    await session.flush()
    return recipe


async def _replace_ingredients(
    session: AsyncSession, *, recipe_id: uuid.UUID, ingredients: Sequence[tuple[uuid.UUID, float]]
) -> None:
    """Состав заменяется целиком: сохранённый `computed` считается по всему набору,
    поэтому частичное обновление строк оставило бы расчёт и состав рассогласованными.

    `position` — порядок в присланном списке: клиент задаёт последовательность
    ингредиентов тем, как их перечислил.
    """

    await session.execute(
        sa_delete(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id)
    )
    for position, (product_id, grams) in enumerate(ingredients):
        session.add(
            RecipeIngredient(
                recipe_id=recipe_id, product_id=product_id, grams=grams, position=position
            )
        )
    await session.flush()


async def count_menu_usages(session: AsyncSession, *, recipe_id: uuid.UUID) -> int:
    """Сколько позиций меню ссылаются на рецепт, включая мягко удалённые.

    Удалённые позиции считаются тоже: меню — история питания ребёнка, и врач
    смотрит её задним числом. Если убрать рецепт, на который ссылается запись
    прошлого месяца, восстановить состав того приёма будет уже нечем.
    """

    total = await session.scalar(
        select(func.count()).select_from(MenuItem).where(MenuItem.recipe_id == recipe_id)
    )
    return int(total or 0)


async def delete(session: AsyncSession, *, recipe: Recipe) -> None:
    """Физическое удаление рецепта вместе с составом.

    Рецепт — контент, а не клиническая запись (раздел 4.1 ТЗ требует мягкого
    удаления именно для клинических и дневниковых таблиц), поэтому `deleted_at`
    у него нет. Защита от осиротевших ссылок — на вызывающей стороне через
    `count_menu_usages`.
    """

    await session.execute(
        sa_delete(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe.id)
    )
    await session.delete(recipe)
    await session.flush()


async def titles_taken(session: AsyncSession, *, titles: list[str]) -> set[str]:
    """Названия из списка, которые уже заняты, — в нормализованном виде.

    Нужно импорту: он не переписывает существующие рецепты, и совпадение по
    названию должно стать ошибкой строки, а не молчаливой перезаписью. Сравнение
    по свёрнутому регистру, как и у продуктов: «Омлет» и «омлет» — одно и то же
    блюдо в глазах человека, который готовит по списку.
    """

    if not titles:
        return set()

    folded = {title.casefold().strip() for title in titles}
    # Мягкого удаления у рецептов нет (раздел 4.2): убирают их сменой статуса,
    # а название остаётся занятым — уникальность в базе от статуса не зависит.
    rows = await session.scalars(select(Recipe.title))
    return {title.casefold().strip() for title in rows if title.casefold().strip() in folded}
