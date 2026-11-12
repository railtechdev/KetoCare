"""Преобразование схем API <-> типов keto_engine.

Единственное место, где API соприкасается с расчётным ядром. Математики здесь
нет — только маппинг (правило: бизнес-логики расчётов в API не бывает).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import replace

from core.models import Prescription, Product
from keto_engine import (
    ENGINE_VERSION,
    DishResult,
    Ingredient,
    MealMacroGoal,
    Targets,
    dietary_unit_kcal,
    meal_macro_goal,
    verify,
)
from keto_engine.constants import DEFAULT_MAX_INGREDIENT_GRAMS, MIN_INGREDIENT_GRAMS

from ..schemas_calc import (
    DishOut,
    IngredientIn,
    ItemIn,
    ItemOut,
    MealGoalOut,
    PrescriptionGoalRequest,
    PrescriptionGoalResponse,
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


#: How far each product may move from the composition. A search bound, not a
#: clinical limit: the solver tends to its bounds and without a corridor it
#: pushes vegetables to the minimum mass.
NEAR_LOWER = 0.5
NEAR_UPPER = 1.5


def near_grams(grams: float, factor: float) -> tuple[float, float | None]:
    """Search corridor for one product at `grams`, after scaling by `factor`."""

    def clamped(value: float) -> float:
        return max(MIN_INGREDIENT_GRAMS, min(value, DEFAULT_MAX_INGREDIENT_GRAMS))

    return clamped(grams * factor * NEAR_LOWER), clamped(grams * factor * NEAR_UPPER)


def near_current(
    caller: Targets,
    keeping_all: Targets,
    ingredients: Mapping[str, Ingredient],
    current_grams: Mapping[str, float] | None,
) -> Targets | None:
    """Targets that keep the solver near the masses in the form, if any are known.

    Products with a bound from the caller (pins) keep it and do not scale.
    """

    if not current_grams:
        return None
    pinned = caller.per_ingredient_bounds or {}
    known = [
        (ingredient, current_grams[product_id])
        for product_id, ingredient in ingredients.items()
        if current_grams.get(product_id, 0) > 0
    ]
    free = [
        (ingredient, grams) for ingredient, grams in known if ingredient.product_id not in pinned
    ]
    if not free:
        return None

    free_kcal = verify(free).kcal
    fixed_kcal = (
        verify(
            [(ingredient, bounds[0]) for ingredient, bounds in _pinned_items(ingredients, pinned)]
        ).kcal
        if pinned
        else 0.0
    )
    remaining = caller.kcal - fixed_kcal
    if free_kcal <= 0 or remaining <= 0:
        return None

    factor = remaining / free_kcal
    bounds = dict(keeping_all.per_ingredient_bounds or {})
    bounds.update({ingredient.product_id: near_grams(grams, factor) for ingredient, grams in free})
    return replace(keeping_all, per_ingredient_bounds=bounds)


def _pinned_items(
    ingredients: Mapping[str, Ingredient],
    pinned: Mapping[str, tuple[float, float | None]],
) -> list[tuple[Ingredient, tuple[float, float | None]]]:
    return [
        (ingredient, pinned[product_id])
        for product_id, ingredient in ingredients.items()
        if product_id in pinned
    ]


def pins_too_small(targets: Targets, product_ids: Iterable[str]) -> list[str]:
    """Products whose upper bound keeps them under the solver's minimum mass.

    The solver leaves such a product out of the dish without saying so, and a
    pinned product is exactly the one that must not disappear.
    """

    bounds = targets.per_ingredient_bounds or {}
    return [
        product_id
        for product_id in product_ids
        if product_id in bounds
        and (upper := bounds[product_id][1]) is not None
        and upper < MIN_INGREDIENT_GRAMS
    ]


def pins_not_whole(targets: Targets, product_ids: Iterable[str]) -> list[str]:
    """Pinned products with a fractional mass: the solver returns whole grams."""

    bounds = targets.per_ingredient_bounds or {}
    return [
        product_id
        for product_id in product_ids
        if product_id in bounds
        and bounds[product_id][0] == bounds[product_id][1]
        and bounds[product_id][0] != round(bounds[product_id][0])
    ]


def missing_from_solution(dish: DishResult, product_ids: Iterable[str]) -> list[str]:
    """Products of the request that did not make it into a solved dish."""

    kept = {item.ingredient.product_id for item in dish.items}
    return [product_id for product_id in product_ids if product_id not in kept]


def _goal_out(goal: MealMacroGoal) -> MealGoalOut:
    return MealGoalOut(
        fat_g=goal.fat_g,
        protein_g=goal.protein_g,
        net_carbs_g=goal.net_carbs_g,
        non_fat_g=goal.non_fat_g,
    )


def to_meal_goal(targets: TargetsIn, prescription: Prescription | None) -> MealGoalOut:
    return _goal_out(
        meal_macro_goal(
            targets.ratio,
            targets.kcal,
            day_protein_g=None if prescription is None else float(prescription.protein_g),
            day_kcal=None if prescription is None else float(prescription.kcal_per_day),
        )
    )


def to_prescription_goal(raw: PrescriptionGoalRequest) -> PrescriptionGoalResponse:
    """A prescription's numbers in grams, for the day and for one equal meal.

    The equal split is the assumption of question 55, the same one the
    calculator's per-meal goal rests on (ADR-0058).
    """

    def goal(kcal: float) -> MealGoalOut:
        return _goal_out(
            meal_macro_goal(raw.ratio, kcal, day_protein_g=raw.protein_g, day_kcal=raw.kcal_per_day)
        )

    return PrescriptionGoalResponse(
        day=goal(raw.kcal_per_day),
        meal=None if raw.meals_per_day is None else goal(raw.kcal_per_day / raw.meals_per_day),
        dietary_unit_kcal=dietary_unit_kcal(raw.ratio),
        engine_version=ENGINE_VERSION,
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
