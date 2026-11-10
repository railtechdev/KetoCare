"""A library recipe fitted to one child's per-meal target.

The library recipe stays as it is: the fit is a proposal the specialist reviews
before anything is saved to the child's dishes (ADR-0059).
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace

from starlette.concurrency import run_in_threadpool

from core.models import Prescription, Product
from keto_engine import InfeasibleError, SolveResult, Targets, solve, verify
from keto_engine.constants import DEFAULT_MAX_INGREDIENT_GRAMS, MIN_INGREDIENT_GRAMS

from . import composition as composition_service

#: How far each product may move from the recipe's proportions. A search bound,
#: not a clinical limit: the solver tends to its bounds, and without a corridor
#: it would turn a recipe into a different dish.
NEAR_RECIPE_LOWER = 0.5
NEAR_RECIPE_UPPER = 1.5


def meal_targets(prescription: Prescription) -> Targets:
    """Per-meal target from a prescription: the equal split of question 24.

    The daily carbohydrate limit bounds a single meal as it stands: how it is
    shared between meals is not decided (question 55), but no meal may exceed
    the whole day's limit.
    """

    return Targets(
        ratio=float(prescription.ratio),
        kcal=round(float(prescription.kcal_per_day) / prescription.meals_per_day),
        carbs_max_g=float(prescription.carbs_limit_g),
    )


@dataclass(frozen=True, slots=True)
class Fit:
    result: SolveResult
    #: The corridor around the recipe could not reach the target, so the
    #: proportions changed freely.
    reshaped: bool
    #: Recipe mass to one meal. Seasonings are not solved and follow this.
    factor: float


@dataclass(frozen=True, slots=True)
class FitFailure:
    reason: str


def _clamped(grams: float) -> float:
    return max(MIN_INGREDIENT_GRAMS, min(grams, DEFAULT_MAX_INGREDIENT_GRAMS))


async def fit_composition(
    products: Mapping[uuid.UUID, Product],
    composition: Sequence[tuple[uuid.UUID, float]],
    targets: Targets,
) -> tuple[Fit | FitFailure, list[composition_service.UncountedItem]]:
    """Fit a composition to the targets, keeping every counted product."""

    counted, uncounted = composition_service.split(
        (products[product_id], grams) for product_id, grams in composition
    )
    if not counted:
        return FitFailure("В составе только приправы, подбирать не из чего."), uncounted

    ingredients = [ingredient for ingredient, _ in counted]
    kcal = verify(counted).kcal
    factor = targets.kcal / kcal if kcal > 0 else 1.0
    near: dict[str, tuple[float, float | None]] = {
        ingredient.product_id: (
            _clamped(grams * factor * NEAR_RECIPE_LOWER),
            _clamped(grams * factor * NEAR_RECIPE_UPPER),
        )
        for ingredient, grams in counted
    }
    anywhere: dict[str, tuple[float, float | None]] = {
        ingredient.product_id: (MIN_INGREDIENT_GRAMS, DEFAULT_MAX_INGREDIENT_GRAMS)
        for ingredient in ingredients
    }

    try:
        solved = await run_in_threadpool(
            solve,
            ingredients,
            replace(targets, per_ingredient_bounds=near),
        )
        return Fit(result=solved, reshaped=False, factor=factor), uncounted
    except InfeasibleError:
        pass

    try:
        solved = await run_in_threadpool(
            solve,
            ingredients,
            replace(targets, per_ingredient_bounds=anywhere),
        )
    except InfeasibleError as exc:
        return FitFailure(exc.reason), uncounted
    return Fit(result=solved, reshaped=True, factor=factor), uncounted
