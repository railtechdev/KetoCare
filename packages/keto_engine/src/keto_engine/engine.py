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
from itertools import product

import numpy as np
from scipy.optimize import OptimizeResult, linprog

from . import constants
from .types import DishResult, InfeasibleError, Ingredient, ItemAmount, SolveResult, Targets

# Сколько продуктов двигаем при починке округления и на сколько шагов.
# 4 продукта по 5 вариантов — 625 комбинаций, каждая считается арифметикой;
# больше не нужно: на соотношение заметно влияют единицы ингредиентов.
_MAX_REPAIR_INGREDIENTS = 4
_REPAIR_RADIUS = 2


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

    # Вклад каждой позиции считается здесь же, а итоги — как сумма вкладов:
    # так строка состава и итог блюда не могут разойтись, потому что их даёт
    # одна арифметика. Второй расчёт вклада (в API или в браузере) был бы
    # вторым источником клинических чисел.
    positions: list[ItemAmount] = []
    fat_g = protein_g = carbs_g = fiber_g = net_carbs_g = 0.0
    for ingredient, grams in items:
        factor = grams / 100.0
        item_fat = ingredient.fat * factor
        item_protein = ingredient.protein * factor
        item_carbs = ingredient.carbs * factor
        item_fiber = ingredient.fiber * factor
        # Клетчатка вычитается ПО КАЖДОМУ продукту и не уходит в минус: у
        # продукта, где её записано больше углеводов, отрицательный вклад
        # завысил бы соотношение всего блюда. Так же считает решатель — иначе
        # подбор и проверка разошлись бы на одном составе.
        item_net_carbs = max(item_carbs - item_fiber, 0.0)
        positions.append(
            ItemAmount(
                ingredient=ingredient,
                grams=grams,
                kcal=_dish_kcal(item_fat, item_protein, item_carbs),
                fat_g=item_fat,
                protein_g=item_protein,
                carbs_g=item_carbs,
                fiber_g=item_fiber,
            )
        )
        fat_g += item_fat
        protein_g += item_protein
        carbs_g += item_carbs
        fiber_g += item_fiber
        net_carbs_g += item_net_carbs

    kcal = _dish_kcal(fat_g, protein_g, carbs_g)

    # Соотношение — по ЧИСТЫМ углеводам (ответ клиники от 09.09.2026, вопросы 2
    # и 6; ADR-0030). Переключателя больше нет: клиника назвала правило, а не
    # выбор. Прежде здесь стоял TODO и общие углеводы, а `verify()` не принимал
    # `Targets` — то есть переключить учёт для проверки было нечем.
    denom = protein_g + net_carbs_g
    ratio = fat_g / denom if denom > 0 else None

    return DishResult(
        items=tuple(positions),
        kcal=kcal,
        fat_g=fat_g,
        protein_g=protein_g,
        carbs_g=carbs_g,
        fiber_g=fiber_g,
        net_carbs_g=net_carbs_g,
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


def max_non_fat_grams(ratio: float, kcal: float) -> float:
    """Максимум суммы белков и ЧИСТЫХ углеводов (г) при таком соотношении и калорийности.

    Тождество, а не медицинское правило: из определения соотношения
    F = R·(P + Cnet) и коэффициентов Атуотера kcal = 9F + 4P + 4Ctotal следует
    kcal = (9R + 4)·(P + Cnet) + 4·Fiber, то есть
    P + Cnet = (kcal − 4·Fiber) / (9R + 4) ≤ kcal / (9R + 4).

    **Это НЕ предел на белок с общими углеводами.** Клетчатка тратит свои
    4 ккал/г, но в знаменатель соотношения не входит (ADR-0030), поэтому блюдо с
    клетчаткой даёт больше общих углеводов, чем возвращает эта функция. Граница
    здесь взята без клетчатки — то есть самая мягкая из возможных, и потому
    верная для любого набора продуктов.

    Назначение, требующее больше белка, чем эта величина, невыполнимо ни при каком
    наборе продуктов — сколько бы их ни перебирал solve(): белок не больше, чем
    белок вместе с чистыми углеводами.
    """

    if ratio <= 0 or kcal <= 0:
        raise ValueError("Соотношение и калорийность должны быть положительными")

    denominator = ratio * constants.KCAL_PER_G_FAT + constants.KCAL_PER_G_PROTEIN
    return kcal / denominator


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
    # Соотношение — по чистым углеводам всегда (ответ клиники, вопросы 2 и 6);
    # `carbs_coef` остаётся общим и держит лимит углеводов (вопрос 3).
    carbs_ratio_coef = np.array([max(ing.carbs - ing.fiber, 0.0) / 100.0 for ing in ingredients])
    kcal_coef = (
        fat_coef * constants.KCAL_PER_G_FAT
        + protein_coef * constants.KCAL_PER_G_PROTEIN
        + carbs_coef * constants.KCAL_PER_G_CARBS
    )

    # Равенство соотношения: F − R·P − R·Cnet = 0 (раздел 6.3 ТЗ). В знаменателе
    # ЧИСТЫЕ углеводы (`carbs_ratio_coef`), а не общие: ответ клиники 09.09.2026,
    # вопросы 2 и 6 (ADR-0030). Лимит `carbs_max_g` ниже режет по общим — это
    # намеренное расхождение, а не описка.
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
    # Соотношение — по чистым углеводам всегда (ответ клиники, вопросы 2 и 6);
    # `carbs_coef` остаётся общим и держит лимит углеводов (вопрос 3).
    carbs_ratio_coef = np.array([max(ing.carbs - ing.fiber, 0.0) / 100.0 for ing in ingredients])
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


def _candidate_is_valid(
    grams: Sequence[float], ingredients: Sequence[Ingredient], targets: Targets
) -> bool:
    """Кандидат допустим: массы в границах и калорийность в коридоре."""

    bounds = _default_bounds(ingredients, targets)
    for value, (lo, hi) in zip(grams, bounds, strict=True):
        if value < 0 or value < lo - 1e-9:
            return False
        if hi is not None and value > hi + 1e-9:
            return False

    items = [
        (ing, g)
        for ing, g in zip(ingredients, grams, strict=True)
        if g >= constants.MIN_INGREDIENT_GRAMS
    ]
    if not items:
        return False

    dish = verify(items)
    tol = constants.KCAL_TOLERANCE_FRACTION
    if abs(dish.kcal - targets.kcal) > targets.kcal * tol:
        return False

    if targets.protein_min_g is not None and dish.protein_g < targets.protein_min_g - 1e-9:
        return False
    return not (targets.carbs_max_g is not None and dish.carbs_g > targets.carbs_max_g + 1e-9)


def _repair_rounding(
    grams: Sequence[float], ingredients: Sequence[Ingredient], targets: Targets
) -> list[float]:
    """Подбирает целочисленные массы рядом с округлённым решением.

    LP решает задачу точно, но массы затем округляются до `GRAM_ROUNDING`, и на
    небольших приёмах пищи это сдвигает соотношение за допуск: при 4:1 и 200 ккал
    решение 23.26/16.53 г округляется в 23/17 г — соотношение 3.85 вместо 4.0,
    хотя рядом есть 24/17 (4.01), укладывающееся и в допуск, и в коридор
    калорийности. Раздел 6.4 ТЗ требует, чтобы `verify(solve(x))` был в допусках;
    без этого шага требование нарушается.

    Перебираются небольшие целочисленные сдвиги у продуктов, сильнее всего
    влияющих на соотношение: у остальных сдвиг на грамм почти не двигает R.
    """

    step = constants.GRAM_ROUNDING
    base = list(grams)

    # Влияние грамма продукта на соотношение: d(F − R·(P + чистые C)) / dm.
    #
    # Чистые, а не общие: производная берётся от той же величины, которую
    # выравнивает решатель, иначе порядок кандидатов считался бы по одной
    # формуле, а результат проверялся по другой.
    #
    # Это ЭВРИСТИКА отбора, а не правило расчёта: она решает, кого двигать
    # первым, и на верность найденного состава не влияет — итог всё равно
    # проверяется `_within_bounds` и допусками. Случая, где выбор кандидата
    # меняет исход, у нас нет, и придумывать его ради красивой цифры не стали:
    # тест на несуществующее поведение хуже отсутствия теста.
    influence = [
        (
            abs(ing.fat - targets.ratio * (ing.protein + max(ing.carbs - ing.fiber, 0.0))),
            index,
        )
        for index, ing in enumerate(ingredients)
    ]
    influence.sort(reverse=True)
    movable = [index for weight, index in influence[:_MAX_REPAIR_INGREDIENTS] if weight > 1e-9]
    if not movable:
        return base

    deltas = [d * step for d in range(-_REPAIR_RADIUS, _REPAIR_RADIUS + 1)]

    best: list[float] | None = None
    best_error = float("inf")

    for combo in product(deltas, repeat=len(movable)):
        candidate = list(base)
        for index, delta in zip(movable, combo, strict=True):
            candidate[index] = max(base[index] + delta, 0.0)

        if not _candidate_is_valid(candidate, ingredients, targets):
            continue

        items = [
            (ing, g)
            for ing, g in zip(ingredients, candidate, strict=True)
            if g >= constants.MIN_INGREDIENT_GRAMS
        ]
        dish = verify(items)
        if dish.ratio is None:
            continue

        error = abs(dish.ratio - targets.ratio)
        if error < best_error:
            best_error, best = error, candidate

        if error <= constants.RATIO_TOLERANCE:
            # Достаточно любого решения в допуске — дальше искать нечего.
            return candidate

    return best if best is not None else base


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
    rounded = [float(g) for g in np.round(grams / rounding) * rounding]

    # Округление до грамма может вывести соотношение за допуск — тогда ищем
    # ближайшую целочисленную комбинацию, которая в допуск укладывается.
    probe = [
        (ing, g)
        for ing, g in zip(ingredients, rounded, strict=True)
        if g >= constants.MIN_INGREDIENT_GRAMS
    ]
    if probe:
        ratio_ok, _ = within_tolerance(verify(probe), targets)
        if not ratio_ok:
            rounded = _repair_rounding(rounded, ingredients, targets)

    items = [
        (ing, g)
        for ing, g in zip(ingredients, rounded, strict=True)
        if g >= constants.MIN_INGREDIENT_GRAMS
    ]

    dish = verify(items)
    ratio_within, kcal_within = within_tolerance(dish, targets)
    return SolveResult(
        dish=dish, ratio_within_tolerance=ratio_within, kcal_within_tolerance=kcal_within
    )
