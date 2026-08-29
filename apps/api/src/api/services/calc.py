"""Преобразование схем API <-> типов keto_engine.

Единственное место, где API соприкасается с расчётным ядром. Математики здесь
нет — только маппинг (правило: бизнес-логики расчётов в API не бывает).
"""

from __future__ import annotations

from keto_engine import DishResult, Ingredient, Targets

from ..schemas_calc import DishOut, IngredientIn, ItemIn, ItemOut, TargetsIn


def to_ingredients(raw: list[IngredientIn]) -> dict[str, Ingredient]:
    return {
        item.product_id: Ingredient(
            product_id=item.product_id,
            kcal=item.kcal,
            fat=item.fat,
            protein=item.protein,
            carbs=item.carbs,
            fiber=item.fiber,
        )
        for item in raw
    }


def to_items(
    ingredients: dict[str, Ingredient], raw: list[ItemIn]
) -> list[tuple[Ingredient, float]]:
    """Бросает KeyError, если item ссылается на продукт вне списка ingredients —
    вызывающий роутер превращает это в validation_error."""

    return [(ingredients[item.product_id], item.grams) for item in raw]


def to_targets(raw: TargetsIn) -> Targets:
    bounds = None
    if raw.per_ingredient_bounds is not None:
        bounds = {pid: (lo, hi) for pid, (lo, hi) in raw.per_ingredient_bounds.items()}

    return Targets(
        ratio=raw.ratio,
        kcal=raw.kcal,
        protein_min_g=raw.protein_min_g,
        carbs_max_g=raw.carbs_max_g,
        per_ingredient_bounds=bounds,
        net_carbs=raw.net_carbs,
    )


def to_dish_out(dish: DishResult) -> DishOut:
    return DishOut(
        items=[
            ItemOut(product_id=item.ingredient.product_id, grams=item.grams) for item in dish.items
        ],
        kcal=dish.kcal,
        fat_g=dish.fat_g,
        protein_g=dish.protein_g,
        carbs_g=dish.carbs_g,
        fiber_g=dish.fiber_g,
        ratio=dish.ratio,
        engine_version=dish.engine_version,
    )
