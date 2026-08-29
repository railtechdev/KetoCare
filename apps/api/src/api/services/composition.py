"""Состав блюда: продукты из базы → типы расчётного ядра.

Единственное место, где строки `products` превращаются в `keto_engine.Ingredient`
и где результат ядра раскладывается в `computed`. Раньше это существовало в трёх
почти дословных копиях (свои блюда, рецепты, меню) — расхождение любой из них
означало бы, что одинаковый состав считается по-разному в разных разделах.

Продукты всегда берутся из базы по идентификаторам, а не из тела запроса: иначе
клиент прислал бы произвольные макронутриенты и получил «правильный» расчёт по
выдуманным данным — а по нему кормят ребёнка.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Product
from core.repositories import products as products_repo
from keto_engine import ENGINE_VERSION, DishResult, Ingredient, verify

from ..errors import ApiError, ErrorCode

#: Состав как пары «продукт — масса в граммах».
Composition = Sequence[tuple[uuid.UUID, float]]


def to_ingredient(product: Product) -> Ingredient:
    """Строка `products` → вход расчётного ядра (значения на 100 г)."""

    return Ingredient(
        product_id=str(product.id),
        kcal=float(product.kcal_100g),
        fat=float(product.fat_100g),
        protein=float(product.protein_100g),
        carbs=float(product.carbs_100g),
        fiber=float(product.fiber_100g),
    )


def totals_of(dish: DishResult) -> dict[str, Any]:
    """Показатели блюда в форме, которая хранится в `computed`/`totals` (раздел 4.2 ТЗ)."""

    return {
        "kcal": dish.kcal,
        "fat": dish.fat_g,
        "protein": dish.protein_g,
        "carbs": dish.carbs_g,
        "fiber": dish.fiber_g,
        "ratio": dish.ratio,
    }


async def load_products(
    session: AsyncSession,
    *,
    product_ids: Sequence[uuid.UUID],
    missing_message: str = "В составе указаны продукты, которых нет в базе.",
) -> dict[uuid.UUID, Product]:
    """Продукты по идентификаторам; отсутствующие — 422 с их перечнем."""

    products = await products_repo.get_by_ids(session, product_ids=product_ids)

    missing = sorted({str(pid) for pid in product_ids if pid not in products})
    if missing:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR, missing_message, details={"product_ids": missing}
        )
    return products


async def load_items(
    session: AsyncSession, *, composition: Composition
) -> list[tuple[Ingredient, float]]:
    """Состав в виде пар (Ingredient, граммы) — вход `verify()`/`scale()`."""

    products = await load_products(
        session, product_ids=[product_id for product_id, _ in composition]
    )
    return [(to_ingredient(products[product_id]), grams) for product_id, grams in composition]


async def compute(session: AsyncSession, *, composition: Composition) -> tuple[dict[str, Any], str]:
    """Показатели непустого состава и версия ядра, которой они получены.

    Версия сохраняется рядом со значениями (раздел 4.1 ТЗ): без неё нельзя
    сказать, каким кодом посчитан сохранённый результат.
    """

    items = await load_items(session, composition=composition)
    return totals_of(verify(items)), ENGINE_VERSION


async def compute_optional(
    session: AsyncSession, *, composition: Composition
) -> tuple[dict[str, Any] | None, str | None]:
    """То же, но пустой состав допустим: у черновика без ингредиентов считать нечего."""

    if not composition:
        return None, None
    return await compute(session, composition=composition)


def duplicate_product_ids(product_ids: Iterable[uuid.UUID]) -> list[uuid.UUID]:
    """Продукты, встречающиеся в составе больше одного раза.

    Один продукт дважды — почти наверняка ошибка ввода, а массы при этом молча
    сложились бы и расчёт выглядел бы правдоподобным.
    """

    seen: set[uuid.UUID] = set()
    duplicates: list[uuid.UUID] = []
    for product_id in product_ids:
        if product_id in seen:
            duplicates.append(product_id)
        seen.add(product_id)
    return duplicates


def stored_composition(composition: Composition) -> list[dict[str, Any]]:
    """Состав в форме, в которой он лежит в jsonb (раздел 4.2 ТЗ: `[{product_id, grams}]`)."""

    return [{"product_id": str(product_id), "grams": grams} for product_id, grams in composition]
