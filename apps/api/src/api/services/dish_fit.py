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
from .calc import aiming_at, closer_to_the_split, meal_goal, near_grams, reaches_the_split


def meal_targets(prescription: Prescription) -> Targets:
    """Per-meal target from a prescription: the equal split of question 24.

    The daily carbohydrate limit bounds a single meal as it stands: how it is
    shared between meals is not decided (question 55), but no meal may exceed
    the whole day's limit. The meal's protein and net carbs are aimed at, the
    same goal the calculator shows and solves for (ADR-0083).
    """

    ratio = float(prescription.ratio)
    kcal = round(float(prescription.kcal_per_day) / prescription.meals_per_day)
    return aiming_at(
        Targets(ratio=ratio, kcal=kcal, carbs_max_g=float(prescription.carbs_limit_g)),
        meal_goal(ratio, kcal, prescription),
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
        ingredient.product_id: near_grams(grams, factor) for ingredient, grams in counted
    }
    anywhere: dict[str, tuple[float, float | None]] = {
        ingredient.product_id: (MIN_INGREDIENT_GRAMS, DEFAULT_MAX_INGREDIENT_GRAMS)
        for ingredient in ingredients
    }

    # Scaled to one meal, the recipe is what the fit stays close to: inside
    # the corridor and, when the corridor cannot reach the goal, outside it.
    targets = replace(
        targets,
        near_grams={ingredient.product_id: grams * factor for ingredient, grams in counted},
    )

    nearby: SolveResult | None = None
    try:
        nearby = await run_in_threadpool(
            solve,
            ingredients,
            replace(targets, per_ingredient_bounds=near),
        )
    except InfeasibleError:
        pass
    else:
        if reaches_the_split(nearby):
            return Fit(result=nearby, reshaped=False, factor=factor), uncounted

    try:
        solved = await run_in_threadpool(
            solve,
            ingredients,
            replace(targets, per_ingredient_bounds=anywhere),
        )
    except InfeasibleError as exc:
        if nearby is not None:
            return Fit(result=nearby, reshaped=False, factor=factor), uncounted
        return FitFailure(exc.reason), uncounted
    # The corridor held the ratio and the calories but not the protein and
    # carbs of the meal: proportions change only if that gets the dish closer.
    if nearby is not None and not closer_to_the_split(solved, nearby):
        return Fit(result=nearby, reshaped=False, factor=factor), uncounted
    return Fit(result=solved, reshaped=True, factor=factor), uncounted
