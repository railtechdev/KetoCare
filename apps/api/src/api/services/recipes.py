"""Пересчёт рецепта расчётным ядром и сборка ответа.

Арифметики здесь нет: состав собирается из строк `products` и уходит в
`keto_engine.verify()`. Итог сохраняется вместе с `ENGINE_VERSION` (раздел 4.1
ТЗ) — без версии нельзя сказать, каким кодом получено сохранённое значение.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Recipe, RecipeIngredient
from keto_engine import DishResult, Targets, within_tolerance

from ..schemas_recipes import (
    RecipeComputed,
    RecipeIngredientIn,
    RecipeIngredientRead,
    RecipeRead,
)
from . import composition as composition_service
from .engine_version import comparable_to_current


def to_composition(ingredients: Sequence[RecipeIngredientIn]) -> list[tuple[uuid.UUID, float]]:
    return [(item.product_id, item.grams) for item in ingredients]


def stored_composition(rows: Sequence[RecipeIngredient]) -> list[tuple[uuid.UUID, float]]:
    return [(row.product_id, float(row.grams)) for row in rows]


async def compute_optional(
    session: AsyncSession, *, composition: Sequence[tuple[uuid.UUID, float]]
) -> tuple[dict[str, Any] | None, str | None]:
    """Показатели рецепта; у черновика без ингредиентов считать нечего."""

    return await composition_service.compute_optional(session, composition=composition)


async def compute(
    session: AsyncSession, *, composition: Sequence[tuple[uuid.UUID, float]]
) -> tuple[dict[str, Any], str]:
    """Показатели непустого состава и версия ядра, которой они получены."""

    return await composition_service.compute(session, composition=composition)


def duplicate_product_ids(ingredients: Sequence[RecipeIngredientIn]) -> list[uuid.UUID]:
    return composition_service.duplicate_product_ids(item.product_id for item in ingredients)


def ratio_fits(
    computed: RecipeComputed | None, engine_version: str | None, target_ratio: float | None
) -> bool | None:
    """Совпадает ли соотношение рецепта с назначенным — допуском самого ядра.

    Своего сравнения здесь нет: допуск — медицинская константа ядра, и копия
    сравнения разошлась бы с ним. Ядро судит о блюде целиком, поэтому рецепт
    подаётся ему итогами; калорийность в цель ставится та же, что у рецепта, —
    о ней здесь не спрашивают.

    Рецепт, посчитанный прежним основным правилом, вердикта не получает: его
    соотношение получено иначе (ADR-0030).
    """

    if target_ratio is None or computed is None or computed.ratio is None:
        return None
    if not comparable_to_current(engine_version):
        return None
    dish = DishResult(
        items=(),
        kcal=computed.kcal,
        fat_g=computed.fat,
        protein_g=computed.protein,
        carbs_g=computed.carbs,
        fiber_g=computed.fiber,
        net_carbs_g=max(computed.carbs - computed.fiber, 0.0),
        ratio=computed.ratio,
    )
    ratio_within, _ = within_tolerance(dish, Targets(ratio=target_ratio, kcal=computed.kcal))
    return ratio_within


def to_read(
    recipe: Recipe,
    ingredients: Sequence[RecipeIngredient],
    *,
    target_ratio: float | None = None,
) -> RecipeRead:
    """Состав хранится отдельной таблицей, поэтому ответ собирается явно, а не
    `model_validate(recipe)`."""

    computed = (
        RecipeComputed.model_validate(recipe.computed) if recipe.computed is not None else None
    )

    return RecipeRead(
        id=recipe.id,
        title=recipe.title,
        category=recipe.category,
        photo_path=recipe.photo_path,
        yield_g=float(recipe.yield_g),
        servings=recipe.servings,
        instructions=recipe.instructions,
        status=recipe.status,
        computed=computed,
        # Считается здесь, а не хранится: `servings` правится вместе с составом,
        # и сохранённая доля порции однажды разошлась бы с ним молча.
        per_portion=computed.per_serving(recipe.servings) if computed is not None else None,
        engine_version=recipe.engine_version,
        author_id=recipe.author_id,
        ingredients=[RecipeIngredientRead.model_validate(row) for row in ingredients],
        created_at=recipe.created_at,
        ratio_fits_prescription=ratio_fits(computed, recipe.engine_version, target_ratio),
    )
