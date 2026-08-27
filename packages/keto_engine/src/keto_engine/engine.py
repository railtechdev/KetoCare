"""Расчётная логика ядра: verify / scale / solve (раздел 6 ТЗ).

Чистые функции, без I/O. `kcal` блюда всегда пересчитывается из макронутриентов
по коэффициентам Атуотера (`constants.KCAL_PER_G_*`), а не берётся из
`Ingredient.kcal` напрямую — это нужно для внутренней согласованности между
соотношением (ratio) и калорийностью в допусках `verify`/`solve`. Продуктовая
`kcal_100g` может не совпадать с этим значением (округления источника данных);
расхождение — открытый вопрос медицинской команде, см.
`docs/medical/OPEN_QUESTIONS.md`.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
from scipy.optimize import OptimizeResult, linprog

from . import constants
from .types import DishResult, InfeasibleError, Ingredient, ItemAmount, SolveResult, Targets


def _fmt_ratio(ratio: float) -> str:
    return f"{ratio:g}:1"


def _dish_kcal(fat_g: float, protein_g: float, carbs_g: float) -> float:
    return (
        fat_g * constants.KCAL_PER_G_FAT
        + protein_g * constants.KCAL_PER_G_PROTEIN
        + carbs_g * constants.KCAL_PER_G_CARBS
    )


def verify(items: Sequence[tuple[Ingredient, float]]) -> DishResult:
    """Считает итоговые показатели блюда по заданным продуктам и массам (г)."""

    fat_g = protein_g = carbs_g = fiber_g = 0.0
    for ingredient, grams in items:
        factor = grams / 100.0
        fat_g += ingredient.fat * factor
        protein_g += ingredient.protein * factor
        carbs_g += ingredient.carbs * factor
        fiber_g += ingredient.fiber * factor

    kcal = _dish_kcal(fat_g, protein_g, carbs_g)

    # TODO(med): net_carbs — ratio считается по общим углеводам (NET_CARBS_DEFAULT).
    # verify() не принимает Targets (контракт раздела 6.1 ТЗ), поэтому переключить
    # net_carbs для verify() нельзя; это ограничение зафиксировано в OPEN_QUESTIONS.md.
    carbs_for_ratio = carbs_g
    denom = protein_g + carbs_for_ratio
    ratio = fat_g / denom if denom > 0 else None

    return DishResult(
        items=tuple(ItemAmount(ingredient=ing, grams=g) for ing, g in items),
        kcal=kcal,
        fat_g=fat_g,
        protein_g=protein_g,
        carbs_g=carbs_g,
        fiber_g=fiber_g,
        ratio=ratio,
        engine_version=constants.ENGINE_VERSION,
    )


def scale(recipe: DishResult, factor: float) -> DishResult:
    """Пересчитывает блюдо с коэффициентом порции (пропорционально массам)."""

    if factor <= 0:
        raise ValueError("Коэффициент пересчёта должен быть положительным")
    scaled_items = [(item.ingredient, item.grams * factor) for item in recipe.items]
    return verify(scaled_items)


def within_tolerance(dish: DishResult, targets: Targets) -> tuple[bool, bool]:
    """Соответствие показателей блюда целям — (ratio_within, kcal_within)."""

    ratio_within = (
        dish.ratio is not None and abs(dish.ratio - targets.ratio) <= constants.RATIO_TOLERANCE
    )
    kcal_within = abs(dish.kcal - targets.kcal) <= targets.kcal * constants.KCAL_TOLERANCE_FRACTION
    return ratio_within, kcal_within


def _default_bounds(
    ingredients: Sequence[Ingredient], targets: Targets
) -> list[tuple[float, float | None]]:
    overrides = targets.per_ingredient_bounds or {}
    bounds: list[tuple[float, float | None]] = []
    for ing in ingredients:
        lo, hi = overrides.get(ing.product_id, (0.0, constants.DEFAULT_MAX_INGREDIENT_GRAMS))
        bounds.append((lo, hi))
    return bounds


def _build_and_solve(
    ingredients: Sequence[Ingredient],
    targets: Targets,
    *,
    include_protein: bool,
    include_carbs: bool,
    include_kcal_corridor: bool,
    bounds_override: list[tuple[float, float | None]] | None = None,
) -> OptimizeResult:
    n = len(ingredients)
    tol = constants.KCAL_TOLERANCE_FRACTION
    kcal_lo = targets.kcal * (1 - tol)
    kcal_hi = targets.kcal * (1 + tol)

    c = np.zeros(n + 1)
    c[-1] = 1.0  # минимизируем t = |kcal(x) - kcal_target|

    fat_coef = np.array([ing.fat / 100.0 for ing in ingredients])
    protein_coef = np.array([ing.protein / 100.0 for ing in ingredients])
    carbs_coef = np.array([ing.carbs / 100.0 for ing in ingredients])
    carbs_ratio_coef = (
        np.array([max(ing.carbs - ing.fiber, 0.0) / 100.0 for ing in ingredients])
        if targets.net_carbs
        else carbs_coef
    )
    kcal_coef = (
        fat_coef * constants.KCAL_PER_G_FAT
        + protein_coef * constants.KCAL_PER_G_PROTEIN
        + carbs_coef * constants.KCAL_PER_G_CARBS
    )

    # Равенство соотношения: F − R·P − R·C = 0 (раздел 6.3 ТЗ)
    a_eq = np.array(
        [
            np.concatenate(
                [fat_coef - targets.ratio * protein_coef - targets.ratio * carbs_ratio_coef, [0.0]]
            )
        ]
    )
    b_eq = [0.0]

    a_ub_rows = [
        np.concatenate([kcal_coef, [-1.0]]),  # kcal(x) - t <= target
        np.concatenate([-kcal_coef, [-1.0]]),  # -kcal(x) - t <= -target
    ]
    b_ub = [targets.kcal, -targets.kcal]

    if include_kcal_corridor:
        a_ub_rows.append(np.concatenate([kcal_coef, [0.0]]))
        b_ub.append(kcal_hi)
        a_ub_rows.append(np.concatenate([-kcal_coef, [0.0]]))
        b_ub.append(-kcal_lo)

    if include_protein and targets.protein_min_g is not None:
        a_ub_rows.append(np.concatenate([-protein_coef, [0.0]]))
        b_ub.append(-targets.protein_min_g)

    if include_carbs and targets.carbs_max_g is not None:
        a_ub_rows.append(np.concatenate([carbs_coef, [0.0]]))
        b_ub.append(targets.carbs_max_g)

    bounds = list(bounds_override or _default_bounds(ingredients, targets))
    bounds.append((0.0, None))  # t >= 0

    return linprog(
        c,
        A_ub=np.array(a_ub_rows),
        b_ub=np.array(b_ub),
        A_eq=a_eq,
        b_eq=b_eq,
        bounds=bounds,
        method="highs",
    )


def _max_achievable_kcal(ingredients: Sequence[Ingredient], targets: Targets) -> float:
    """Максимальная калорийность, достижимая при равенстве соотношения и текущих
    границах масс (без коридора калорийности/белка/углеводов). Используется только
    для диагностики: `x = 0` всегда тривиально удовлетворяет равенству соотношения,
    поэтому просто убрать коридор недостаточно — нужно явно проверить, есть ли
    ненулевое решение."""

    fat_coef = np.array([ing.fat / 100.0 for ing in ingredients])
    protein_coef = np.array([ing.protein / 100.0 for ing in ingredients])
    carbs_coef = np.array([ing.carbs / 100.0 for ing in ingredients])
    carbs_ratio_coef = (
        np.array([max(ing.carbs - ing.fiber, 0.0) / 100.0 for ing in ingredients])
        if targets.net_carbs
        else carbs_coef
    )
    kcal_coef = (
        fat_coef * constants.KCAL_PER_G_FAT
        + protein_coef * constants.KCAL_PER_G_PROTEIN
        + carbs_coef * constants.KCAL_PER_G_CARBS
    )

    a_eq = np.array([fat_coef - targets.ratio * protein_coef - targets.ratio * carbs_ratio_coef])
    bounds = _default_bounds(ingredients, targets)

    result = linprog(-kcal_coef, A_eq=a_eq, b_eq=[0.0], bounds=bounds, method="highs")
    if result.status == 3:  # unbounded — соотношение достижимо без верхнего предела
        return float("inf")
    if not result.success:
        return 0.0
    return float(-result.fun)


def _diagnose_infeasibility(ingredients: Sequence[Ingredient], targets: Targets) -> str:
    """Определяет причину неразрешимости поочерёдным ослаблением ограничений (раздел 6.3 ТЗ)."""

    max_kcal = _max_achievable_kcal(ingredients, targets)
    if max_kcal < max(targets.kcal * 0.01, 1.0):
        if targets.ratio > 0 and all(ing.fat <= 0 for ing in ingredients):
            return (
                f"С выбранными продуктами недостижимо соотношение {_fmt_ratio(targets.ratio)} — "
                "добавьте жировой компонент."
            )
        return (
            f"С выбранными продуктами и текущими ограничениями недостижимо соотношение "
            f"{_fmt_ratio(targets.ratio)} — попробуйте другой набор продуктов."
        )

    if targets.protein_min_g is not None:
        without_protein = _build_and_solve(
            ingredients,
            targets,
            include_protein=False,
            include_carbs=True,
            include_kcal_corridor=True,
        )
        if without_protein.success:
            return (
                f"Недостижима цель по белку ({targets.protein_min_g:g} г) при соотношении "
                f"{_fmt_ratio(targets.ratio)} и калорийности {targets.kcal:g} ккал — "
                "уменьшите цель по белку или замените продукты."
            )

    if targets.carbs_max_g is not None:
        without_carbs = _build_and_solve(
            ingredients,
            targets,
            include_protein=True,
            include_carbs=False,
            include_kcal_corridor=True,
        )
        if without_carbs.success:
            return (
                f"Недостижим лимит углеводов ({targets.carbs_max_g:g} г) при соотношении "
                f"{_fmt_ratio(targets.ratio)} и калорийности {targets.kcal:g} ккал — "
                "увеличьте лимит или замените продукты."
            )

    if targets.per_ingredient_bounds:
        default_bounds = _default_bounds(
            ingredients, Targets(ratio=targets.ratio, kcal=targets.kcal)
        )
        without_bounds = _build_and_solve(
            ingredients,
            targets,
            include_protein=True,
            include_carbs=True,
            include_kcal_corridor=True,
            bounds_override=default_bounds,
        )
        if without_bounds.success:
            return (
                f"Заданные границы масс ингредиентов слишком узкие для соотношения "
                f"{_fmt_ratio(targets.ratio)} и калорийности {targets.kcal:g} ккал — "
                "расширьте диапазон допустимой массы."
            )

    return (
        f"Недостижима калорийность {targets.kcal:g} ккал при соотношении "
        f"{_fmt_ratio(targets.ratio)} с этими продуктами и ограничениями — "
        "измените набор продуктов, границы масс или ослабьте цель."
    )


def solve(ingredients: Sequence[Ingredient], targets: Targets) -> SolveResult:
    """Подбирает массы продуктов под цели. Бросает `InfeasibleError`, если задача неразрешима."""

    if not ingredients:
        raise InfeasibleError("Список продуктов пуст — добавьте хотя бы один продукт.")

    result = _build_and_solve(
        ingredients, targets, include_protein=True, include_carbs=True, include_kcal_corridor=True
    )

    if not result.success:
        raise InfeasibleError(_diagnose_infeasibility(ingredients, targets))

    grams = result.x[: len(ingredients)]
    rounding = constants.GRAM_ROUNDING
    rounded = np.round(grams / rounding) * rounding

    items = [
        (ing, float(g))
        for ing, g in zip(ingredients, rounded, strict=True)
        if g >= constants.MIN_INGREDIENT_GRAMS
    ]

    dish = verify(items)
    ratio_within, kcal_within = within_tolerance(dish, targets)
    return SolveResult(
        dish=dish, ratio_within_tolerance=ratio_within, kcal_within_tolerance=kcal_within
    )
