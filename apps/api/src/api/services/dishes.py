"""Пересчёт состава своего блюда через расчётное ядро.

Математики здесь нет — только сборка `Ingredient` из строк `products` и вызов
`keto_engine.verify()`. Итог сохраняется вместе с `ENGINE_VERSION` (раздел 4.1 ТЗ):
без версии нельзя сказать, каким кодом получено сохранённое значение.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.repositories import custom_dishes as dishes_repo
from keto_engine import ENGINE_VERSION, Ingredient, verify

from ..errors import ApiError, ErrorCode
from ..schemas import DishIngredientIn


async def compute_dish(
    session: AsyncSession, *, ingredients: list[DishIngredientIn]
) -> tuple[list[dict[str, Any]], dict[str, Any], str]:
    """Возвращает (нормализованный состав, computed, engine_version).

    Продукты берутся из базы, а не из тела запроса: иначе клиент мог бы прислать
    произвольные макронутриенты и получить «правильный» расчёт по выдуманным
    данным — а это блюдо потом ест ребёнок.
    """

    product_ids = [item.product_id for item in ingredients]
    products = await dishes_repo.get_products_by_ids(session, product_ids=product_ids)

    missing = [str(pid) for pid in product_ids if pid not in products]
    if missing:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "В составе указаны продукты, которых нет в базе.",
            details={"product_ids": missing},
        )

    items = []
    stored: list[dict[str, Any]] = []
    for item in ingredients:
        product = products[item.product_id]
        items.append(
            (
                Ingredient(
                    product_id=str(product.id),
                    kcal=float(product.kcal_100g),
                    fat=float(product.fat_100g),
                    protein=float(product.protein_100g),
                    carbs=float(product.carbs_100g),
                    fiber=float(product.fiber_100g),
                ),
                item.grams,
            )
        )
        stored.append({"product_id": str(item.product_id), "grams": item.grams})

    dish = verify(items)
    computed = {
        "kcal": dish.kcal,
        "fat": dish.fat_g,
        "protein": dish.protein_g,
        "carbs": dish.carbs_g,
        "fiber": dish.fiber_g,
        "ratio": dish.ratio,
    }
    return stored, computed, ENGINE_VERSION


def duplicate_product_ids(ingredients: list[DishIngredientIn]) -> list[uuid.UUID]:
    """Один продукт дважды в составе — почти наверняка ошибка ввода, а массы
    при этом молча сложились бы."""

    seen: set[uuid.UUID] = set()
    duplicates: list[uuid.UUID] = []
    for item in ingredients:
        if item.product_id in seen:
            duplicates.append(item.product_id)
        seen.add(item.product_id)
    return duplicates
