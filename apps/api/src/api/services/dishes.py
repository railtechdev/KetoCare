"""Свои блюда родителя: подготовка состава к сохранению.

Расчёт и загрузка продуктов — в `services/composition.py`, общем для блюд,
рецептов и меню. Здесь остаётся только перевод схемы запроса в состав.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from ..schemas import DishIngredientIn
from . import composition as composition_service


def _composition(ingredients: list[DishIngredientIn]) -> composition_service.Composition:
    return [(item.product_id, item.grams) for item in ingredients]


async def compute_dish(
    session: AsyncSession, *, ingredients: list[DishIngredientIn]
) -> tuple[list[dict[str, Any]], dict[str, Any], str]:
    """Возвращает (состав для хранения, computed, engine_version)."""

    parts = _composition(ingredients)
    computed, engine_version = await composition_service.compute(session, composition=parts)
    return composition_service.stored_composition(parts), computed, engine_version


def duplicate_product_ids(ingredients: list[DishIngredientIn]) -> list[uuid.UUID]:
    return composition_service.duplicate_product_ids(item.product_id for item in ingredients)
