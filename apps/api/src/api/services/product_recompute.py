"""Пересчёт рецептов и своих блюд после правки чисел продукта.

Прежде сохранённый `computed` пересчитывался только при следующей записи
рецепта или блюда (ADR-0054), и между правкой продукта и этой записью каталог,
пометка «соотношение рецепта не как в назначении» и подгонка блюд показывали
числа по прежнему составу продукта — без какой-либо пометки (аудит расчётов
13.11.2026). Теперь пересчёт идёт в той же транзакции, что и правка продукта.

Дни меню не пересчитываются: они заморожены снимком (ADR-0016) и уже говорят
«блюдо изменилось с тех пор, как день составлен».
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from core.repositories import audit as audit_repo
from core.repositories import custom_dishes as dishes_repo
from core.repositories import recipes as recipes_repo

from . import composition as composition_service


async def recompute_after_product_change(
    session: AsyncSession, *, product_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[int, int]:
    """Пересчитать всё, где стоит продукт. Возвращает (рецептов, блюд)."""

    recipe_ids: list[str] = []
    for recipe in await recipes_repo.using_product(session, product_id=product_id):
        rows = await recipes_repo.list_ingredients(session, recipe_id=recipe.id)
        composition = [(row.product_id, float(row.grams)) for row in rows]
        computed, engine_version = await composition_service.compute_optional(
            session, composition=composition
        )
        await recipes_repo.set_computed(
            session, recipe=recipe, computed=computed, engine_version=engine_version
        )
        recipe_ids.append(str(recipe.id))

    dish_ids: list[str] = []
    for dish in await dishes_repo.using_product(session, product_id=product_id):
        composition = [
            (uuid.UUID(row["product_id"]), float(row["grams"])) for row in dish.ingredients
        ]
        computed, engine_version = await composition_service.compute_optional(
            session, composition=composition
        )
        if computed is None or engine_version is None:
            continue
        await dishes_repo.set_computed(
            session, dish=dish, computed=computed, engine_version=engine_version
        )
        dish_ids.append(str(dish.id))

    if recipe_ids or dish_ids:
        await audit_repo.write_audit_log(
            session,
            user_id=user_id,
            action="recompute_after_product_update",
            entity="products",
            entity_id=product_id,
            after={"recipes": recipe_ids, "custom_dishes": dish_ids},
        )
    return len(recipe_ids), len(dish_ids)
