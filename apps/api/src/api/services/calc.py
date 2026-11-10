"""Преобразование схем API <-> типов keto_engine.

Единственное место, где API соприкасается с расчётным ядром. Математики здесь
нет — только маппинг (правило: бизнес-логики расчётов в API не бывает).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import replace

from core.models import Prescription, Product
from keto_engine import DishResult, Ingredient, Targets, meal_macro_goal
from keto_engine.constants import DEFAULT_MAX_INGREDIENT_GRAMS, MIN_INGREDIENT_GRAMS

from ..schemas_calc import (
    DishOut,
    IngredientIn,
    ItemIn,
    ItemOut,
    MealGoalOut,
    TargetsIn,
    UncountedItemOut,
)


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


def split_items(
    items: list[tuple[Ingredient, float]], uncounted: Mapping[str, Product]
) -> tuple[list[tuple[Ingredient, float]], list[UncountedItemOut]]:
    """Состав `/calc` → (вход ядра, приправы).

    Что приправа, решает справочник (`composition.uncounted_products`), а не
    тело запроса; здесь состав только раскладывается по готовому ответу.
    """

    counted: list[tuple[Ingredient, float]] = []
    skipped: list[UncountedItemOut] = []
    for ingredient, grams in items:
        product = uncounted.get(ingredient.product_id)
        if product is None:
            counted.append((ingredient, grams))
        else:
            skipped.append(
                UncountedItemOut(
                    product_id=ingredient.product_id, name_ru=product.name_ru, grams=grams
                )
            )
    return counted, skipped


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
    )


def keeping_every_product(targets: Targets, product_ids: Iterable[str]) -> Targets:
    """Targets under which the solver may not drop a product the person chose.

    Bounds the caller set explicitly stay as they are.
    """

    bounds: dict[str, tuple[float, float | None]] = {
        product_id: (MIN_INGREDIENT_GRAMS, DEFAULT_MAX_INGREDIENT_GRAMS)
        for product_id in product_ids
    }
    bounds.update(targets.per_ingredient_bounds or {})
    return replace(targets, per_ingredient_bounds=bounds)


def missing_from_solution(dish: DishResult, product_ids: Iterable[str]) -> list[str]:
    """Products of the request that did not make it into a solved dish."""

    kept = {item.ingredient.product_id for item in dish.items}
    return [product_id for product_id in product_ids if product_id not in kept]


def to_meal_goal(targets: TargetsIn, prescription: Prescription | None) -> MealGoalOut:
    goal = meal_macro_goal(
        targets.ratio,
        targets.kcal,
        day_protein_g=None if prescription is None else float(prescription.protein_g),
        day_kcal=None if prescription is None else float(prescription.kcal_per_day),
    )
    return MealGoalOut(
        fat_g=goal.fat_g,
        protein_g=goal.protein_g,
        net_carbs_g=goal.net_carbs_g,
        non_fat_g=goal.non_fat_g,
    )


def to_dish_out(dish: DishResult) -> DishOut:
    return DishOut(
        items=[
            ItemOut(
                product_id=item.ingredient.product_id,
                grams=item.grams,
                kcal=item.kcal,
                fat_g=item.fat_g,
                protein_g=item.protein_g,
                carbs_g=item.carbs_g,
                fiber_g=item.fiber_g,
                net_carbs_g=item.net_carbs_g,
            )
            for item in dish.items
        ],
        kcal=dish.kcal,
        fat_g=dish.fat_g,
        protein_g=dish.protein_g,
        carbs_g=dish.carbs_g,
        fiber_g=dish.fiber_g,
        net_carbs_g=dish.net_carbs_g,
        ratio=dish.ratio,
        engine_version=dish.engine_version,
    )
