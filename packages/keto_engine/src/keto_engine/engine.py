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

import math
from collections.abc import Sequence
from dataclasses import replace
from itertools import product

import numpy as np
import numpy.typing as npt
from scipy.optimize import OptimizeResult, linprog

from . import constants
from .types import (
    DishResult,
    InfeasibleError,
    Ingredient,
    ItemAmount,
    MacroFit,
    MealMacroGoal,
    SolveResult,
    Targets,
)

# Сколько продуктов двигаем при починке округления и на сколько шагов.
# 4 продукта по 5 вариантов — 625 комбинаций, каждая считается арифметикой;
# больше не нужно: на соотношение заметно влияют единицы ингредиентов.
_MAX_REPAIR_INGREDIENTS = 4
_REPAIR_RADIUS = 2

# Сколько от лучшего достижимого попадания в цели подбор отдаёт за то, чтобы
# остаться рядом с набранным составом, — в долях допуска. Не медицинская
# константа: цели решаются первыми и без неё, а она выбирает между составами,
# которые попадают в них почти одинаково. Ноль вернул бы прежнее поведение на
# овощах: клетчатка стоит калорий и не входит в соотношение, поэтому «точные»
# ккал подбор добывал, выбрасывая огурец ради лишней килокалории. Четверть
# допуска — это 1,25 % калорийности приёма или четверть грамма белка, меньше
# того, что съедает округление до целых граммов.
_GOAL_SLACK = 0.25

_Vector = npt.NDArray[np.float64]


def _fmt_ratio(ratio: float) -> str:
    return f"{ratio:g}:1"


def _dish_kcal(fat_g: float, protein_g: float, carbs_g: float) -> float:
    return (
        fat_g * constants.KCAL_PER_G_FAT
        + protein_g * constants.KCAL_PER_G_PROTEIN
        + carbs_g * constants.KCAL_PER_G_CARBS
    )


#: Доля, ниже которой чистые углеводы неотличимы от ошибки вычитания.
#:
#: `Cnet = carbs - fiber` — разность почти равных чисел: когда клетчатка
#: составляет почти все углеводы, значащие разряды сокращаются, и остаётся
#: мусор округления. Машинная точность double — 2.2e-16 от величины слагаемых;
#: раздел 6.4 ТЗ требует линейности `verify()` по массам, а property-тест
#: сверяет её с относительным допуском 1e-6. Отсюда порог: 2.2e-16 / 1e-6 с
#: округлением вверх — ниже него погрешность самой разности выше допуска, с
#: которым мы обещаем воспроизводимость.
#:
#: Порог АРИФМЕТИЧЕСКИЙ, а не клинический: величину в граммах пришлось бы
#: выдумать, а медицинские константы не выдумываются (правило 1). С какой массы
#: чистых углеводов соотношение теряет КЛИНИЧЕСКИЙ смысл — вопрос 51
#: медицинской команде; их граница почти наверняка много выше.
_NET_CARBS_SIGNIFICANCE = 1.0e-9


def _significant_net_carbs(net_carbs_g: float, carbs_g: float, fiber_g: float) -> float:
    """Чистые углеводы, если они отличимы от ошибки вычитания, иначе ноль.

    Незначимый остаток именно ОБНУЛЯЕТСЯ, а не отбрасывает блюдо целиком:
    знаменатель складывается из белка и чистых углеводов, и когда белок есть,
    соотношение считается по нему и остаётся устойчивым. Первая редакция
    отвергала такие блюда, и одно и то же блюдо на разных массах давало то
    число, то «не определено» — то есть воспроизводила дефект, который чинила.

    Мерой служат сами слагаемые разности, а не абсолютная величина: так решение
    однородно по массе и не зависит от того, в какой посуде взвесили порцию.
    """
    if net_carbs_g <= _NET_CARBS_SIGNIFICANCE * (carbs_g + fiber_g):
        return 0.0
    return net_carbs_g


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
                net_carbs_g=item_net_carbs,
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
    denom = protein_g + _significant_net_carbs(net_carbs_g, carbs_g, fiber_g)
    ratio = None
    if denom > 0.0:
        candidate = fat_g / denom
        # Деление на законно крошечный знаменатель (денормализованные величины,
        # 2.2e-311) переполняется: наружу уходило «бесконечное соотношение» —
        # 52 случая на 29 тысяч выданных в прогоне на 30000 примеров. Здесь
        # знаменатель ВЕРЕН, просто исчезающе мал, и проверка значимости его не
        # касается. Бесконечность — не число, и в снимок дня, отчёт и сводку
        # врача ей ходу нет.
        ratio = candidate if math.isfinite(candidate) else None

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


def within_tolerance(dish: DishResult, targets: Targets) -> tuple[bool | None, bool]:
    """Соответствие показателей блюда целям — (ratio_within, kcal_within).

    По соотношению ответов ТРИ, а не два: `None` — «сказать нечего», когда
    соотношения у блюда нет вовсе (пустой знаменатель или незначимые чистые
    углеводы, ADR-0037). Прежде этот случай схлопывался в `False`, и «не
    определено» становилось неотличимо от «не соответствует назначению»: врач
    получал в списке пациентов красную пометку «питание вне допуска» за день,
    про который ядро ничего не говорило.

    Калорийность считается всегда: она есть у любого блюда.
    """

    ratio_within = (
        None if dish.ratio is None else abs(dish.ratio - targets.ratio) <= constants.RATIO_TOLERANCE
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


def dietary_unit_kcal(ratio: float) -> float:
    """Energy of one dietary unit at this ratio: R g of fat plus 1 g of protein
    with net carbs, at 9 and 4 kcal per gram (4:1 -> 40 kcal, 3:1 -> 31 kcal).

    The same identity as `max_non_fat_grams`: daily calories divided by this
    number is the count of units, and that count is the grams of protein with
    net carbs. Shown so the doctor can follow the arithmetic as on the clinic's
    Yonsei slide.
    """

    if ratio <= 0:
        raise ValueError("Соотношение должно быть положительным")
    return ratio * constants.KCAL_PER_G_FAT + constants.KCAL_PER_G_PROTEIN


def energy_requirement(age_years: int, weight_kg: float) -> tuple[float, float]:
    """Daily calorie range for a child of this age and weight (question 56).

    The table row is picked by full years of age; the range is weight times the
    row's kcal per kilogram. A hint for the prescription form: the doctor enters
    the prescribed number.
    """

    if age_years < 0:
        raise ValueError("Возраст не может быть отрицательным")
    if weight_kg <= 0:
        raise ValueError("Вес должен быть положительным")
    for upper, low, high in constants.ENERGY_KCAL_PER_KG_BY_AGE:
        if age_years < upper:
            return weight_kg * low, weight_kg * high
    raise AssertionError("the last row covers every age")  # pragma: no cover


def protein_requirement(weight_kg: float) -> float:
    """Daily protein target in grams: weight times `PROTEIN_G_PER_KG`."""

    if weight_kg <= 0:
        raise ValueError("Вес должен быть положительным")
    return weight_kg * constants.PROTEIN_G_PER_KG


def fluid_requirement(weight_kg: float) -> float:
    """Daily fluid volume in mL by the Holliday-Segar method (question 53).

    Each band of `FLUID_ML_PER_KG_BANDS` contributes its mL per kg for the
    kilograms of weight that fall into it. A hint for the prescription form.
    """

    if weight_kg <= 0:
        raise ValueError("Вес должен быть положительным")
    total = 0.0
    lower = 0.0
    for upper, ml_per_kg in constants.FLUID_ML_PER_KG_BANDS:
        if weight_kg <= lower:
            break
        total += (min(weight_kg, upper) - lower) * ml_per_kg
        lower = upper
    return total


def meal_macro_goal(
    ratio: float,
    kcal: float,
    *,
    day_protein_g: float | None = None,
    day_kcal: float | None = None,
    day_carbs_limit_g: float | None = None,
) -> MealMacroGoal:
    """Fat, protein and net carbs one meal should contain.

    Fat and the protein-plus-net-carbs sum follow from the ratio and calories.
    Protein is the daily target's share of this meal's calories, which for
    equal meals is the daily target divided by their number. Net carbs are what
    remains of the sum, and no more than the meal's share of the day's carbs
    limit when one is given: a doctor may set the limit below the remainder,
    and then the rest of the sum is protein. Without that cap five meals "on
    goal" came to twice the limit of their own prescription.

    TODO(med): confirm the equal split of protein and of the carbs limit across
    meals (questions 55 and 58 in docs/medical/OPEN_QUESTIONS.md). Since 1.9.0
    the solver aims at this goal and `macro_fit()` judges a dish against it.
    """

    non_fat = max_non_fat_grams(ratio, kcal)
    fat = ratio * non_fat
    if day_protein_g is None or day_kcal is None:
        return MealMacroGoal(fat_g=fat, protein_g=None, net_carbs_g=None, non_fat_g=non_fat)
    if day_kcal <= 0:
        raise ValueError("Суточная калорийность должна быть положительной")

    protein = day_protein_g * kcal / day_kcal
    if protein > non_fat:
        return MealMacroGoal(fat_g=fat, protein_g=None, net_carbs_g=None, non_fat_g=non_fat)
    net_carbs = non_fat - protein
    if day_carbs_limit_g is not None:
        net_carbs = min(net_carbs, day_carbs_limit_g * kcal / day_kcal)
    return MealMacroGoal(
        fat_g=fat, protein_g=non_fat - net_carbs, net_carbs_g=net_carbs, non_fat_g=non_fat
    )


def macro_fit(
    dish: DishResult,
    protein_g: float | None,
    net_carbs_g: float | None,
    carbs_max_g: float | None = None,
) -> MacroFit | None:
    """How a dish sits against the protein and net carbs goals of its meal.

    `None` when neither goal is given: there is nothing to compare with. The
    ratio and the calories do not pin the split: a dish can hold both exactly
    with all of its non-fat grams in protein, and the dietitian reads that as
    a meal that missed its goal (ADR-0083).

    `carbs_max_g` is the limit on ALL carbs of the dish, the same number the
    solver holds as a bound. The goal counts net carbs, so the fibre of the dish
    eats into it: with 4.3 g allowed and 1.7 g of fibre no more than 2.6 g of
    net carbs fit, whatever the goal says. A dish at that ceiling is not short
    of carbs, and the protein that took their place is not an excess. Telling
    the family to "add carbs" there would walk the day over its limit.
    """

    if protein_g is None and net_carbs_g is None:
        return None
    limited_by = 0.0
    if net_carbs_g is not None and carbs_max_g is not None:
        room = max(carbs_max_g - (dish.carbs_g - dish.net_carbs_g), 0.0)
        limited_by = max(net_carbs_g - room, 0.0)
    protein_delta = None if protein_g is None else dish.protein_g - (protein_g + limited_by)
    net_carbs_delta = None if net_carbs_g is None else dish.net_carbs_g - (net_carbs_g - limited_by)
    within = all(
        abs(delta) <= constants.MEAL_MACRO_TOLERANCE_G + 1e-9
        for delta in (protein_delta, net_carbs_delta)
        if delta is not None
    )
    return MacroFit(
        protein_delta_g=protein_delta,
        net_carbs_delta_g=net_carbs_delta,
        carbs_limited_by_g=limited_by,
        within_tolerance=within,
    )


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
    goal_budget: float | None = None,
    hold_split: bool = False,
    leave_rounding_room: bool = False,
) -> OptimizeResult:
    """One linear programme over the masses.

    Without `goal_budget` it minimises the distance to the goals. With it, the
    distance to the goals is capped by the budget and the programme minimises
    how many grams the composition moves from `targets.near_grams`: the second
    pass of `solve()`.

    `hold_split` turns the tolerance of the protein and net carbs goals into
    bounds. The distance is a sum, and a sum trades a gram of carbs for exact
    calories: without the bounds the programme returned a dish outside the
    tolerance of the split where one inside it existed.

    `leave_rounding_room` keeps the exact solution away from the protein
    minimum and the carbs limit by as much as rounding every mass to a whole
    gram can move them. A solution that sits on the limit breaks it on half of
    the roundings, and the products that carry the carbs are rarely the ones
    the whole-gram search moves.
    """

    n = len(ingredients)
    tol = constants.KCAL_TOLERANCE_FRACTION
    kcal_lo = targets.kcal * (1 - tol)
    kcal_hi = targets.kcal * (1 + tol)

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

    # Переменные: массы продуктов, затем по одной на каждое отклонение, которое
    # минимизируется, — |kcal(x) − цель| и, если заданы цели приёма,
    # |белок(x) − цель| и |чистые углеводы(x) − цель|. Каждое отклонение входит в
    # цель в долях своего допуска: так «на грамм белка мимо» и «на 14 ккал мимо»
    # сравниваются одной мерой, той же, что у `_distance` при выборе целых граммов.
    deviations: list[tuple[_Vector, float, float]] = [
        (kcal_coef, targets.kcal, targets.kcal * tol or 1.0)
    ]
    if targets.protein_g is not None:
        deviations.append((protein_coef, targets.protein_g, constants.MEAL_MACRO_TOLERANCE_G))
    if targets.net_carbs_g is not None:
        deviations.append((carbs_ratio_coef, targets.net_carbs_g, constants.MEAL_MACRO_TOLERANCE_G))

    goal_count = len(deviations)

    # Близость к набранному составу — то же отклонение, только по массе одного
    # продукта. В первом проходе она не считается вовсе: цели решаются без неё.
    if goal_budget is not None:
        near = targets.near_grams or {}
        for index, ing in enumerate(ingredients):
            if ing.product_id in near:
                unit = np.zeros(n)
                unit[index] = 1.0
                deviations.append((unit, near[ing.product_id], 1.0))
    extra = len(deviations)

    def row(coef: _Vector, slack: int | None = None) -> _Vector:
        tail = np.zeros(extra)
        if slack is not None:
            tail[slack] = -1.0
        return np.concatenate([coef, tail])

    goal_cost = np.concatenate(
        [
            np.zeros(n),
            [1.0 / scale for _, _, scale in deviations[:goal_count]],
            np.zeros(extra - goal_count),
        ]
    )
    c = (
        goal_cost
        if goal_budget is None
        else np.concatenate([np.zeros(n + goal_count), np.ones(extra - goal_count)])
    )

    # Равенство соотношения: F − R·P − R·Cnet = 0 (раздел 6.3 ТЗ). В знаменателе
    # ЧИСТЫЕ углеводы (`carbs_ratio_coef`), а не общие: ответ клиники 09.09.2026,
    # вопросы 2 и 6 (ADR-0030). Лимит `carbs_max_g` ниже режет по общим — это
    # намеренное расхождение, а не описка.
    a_eq = np.array(
        [row(fat_coef - targets.ratio * protein_coef - targets.ratio * carbs_ratio_coef)]
    )
    b_eq = [0.0]

    a_ub_rows: list[_Vector] = []
    b_ub: list[float] = []
    for index, (coef, goal, _) in enumerate(deviations):
        a_ub_rows.append(row(coef, index))  # value(x) − d <= goal
        b_ub.append(goal)
        a_ub_rows.append(row(-coef, index))  # −value(x) − d <= −goal
        b_ub.append(-goal)

    if include_kcal_corridor:
        a_ub_rows.append(row(kcal_coef))
        b_ub.append(kcal_hi)
        a_ub_rows.append(row(-kcal_coef))
        b_ub.append(-kcal_lo)

    half_step = constants.GRAM_ROUNDING / 2 if leave_rounding_room else 0.0

    if include_protein and targets.protein_min_g is not None:
        a_ub_rows.append(row(-protein_coef))
        b_ub.append(-(targets.protein_min_g + half_step * float(protein_coef.sum())))

    if include_carbs and targets.carbs_max_g is not None:
        a_ub_rows.append(row(carbs_coef))
        b_ub.append(targets.carbs_max_g - half_step * float(carbs_coef.sum()))

    if goal_budget is not None:
        a_ub_rows.append(goal_cost)
        b_ub.append(goal_budget)

    if hold_split:
        for coef, goal, _ in deviations[1:goal_count]:
            a_ub_rows.append(row(coef))
            b_ub.append(goal + constants.MEAL_MACRO_TOLERANCE_G)
            a_ub_rows.append(row(-coef))
            b_ub.append(-(goal - constants.MEAL_MACRO_TOLERANCE_G))

    bounds = list(bounds_override or _default_bounds(ingredients, targets))
    bounds.extend([(0.0, None)] * extra)  # отклонения неотрицательны

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
    #
    # Зажим `max(..., 0)` здесь ДИАГНОСТИЧЕСКИЙ и тестом не различается: путь
    # ищет только человекочитаемую причину `InfeasibleError`, а сработать зажим
    # может лишь на продукте, у которого клетчатки больше углеводов, — такой
    # импорт отвергает. Оставлен ради одной формы выражения с решателем: два
    # написания одного правила расходятся, и разошлись бы молча.
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


def _distance(dish: DishResult, ratio: float, targets: Targets) -> float:
    """How far a dish is from the targets, in shares of their tolerances.

    One measure for the ratio, the calories and the meal's protein and net
    carbs, so that candidates can be compared at all: a dish 0.15 off the ratio
    is as far as one 5 % off the calories or one gram off the protein.
    """

    distance = abs(ratio - targets.ratio) / constants.RATIO_TOLERANCE
    distance += abs(dish.kcal - targets.kcal) / (
        targets.kcal * constants.KCAL_TOLERANCE_FRACTION or 1.0
    )
    fit = macro_fit(dish, targets.protein_g, targets.net_carbs_g, targets.carbs_max_g)
    if fit is not None:
        distance += sum(
            abs(delta) / constants.MEAL_MACRO_TOLERANCE_G
            for delta in (fit.protein_delta_g, fit.net_carbs_delta_g)
            if delta is not None
        )
    return distance


def _candidate_rank(
    grams: Sequence[float], ingredients: Sequence[Ingredient], targets: Targets
) -> tuple[bool, bool, float] | None:
    """Rank of a whole-gram composition, lower is better; `None` if it is not allowed.

    Allowed means: masses inside their bounds, calories inside the corridor,
    protein not below its minimum, carbs not above their limit, and a ratio that
    exists. Among the allowed, a ratio inside its tolerance always wins over one
    outside it, then a split of protein and carbs inside its tolerance over one
    outside, and then the closest to every target wins.
    """

    bounds = _default_bounds(ingredients, targets)
    for value, (lo, hi) in zip(grams, bounds, strict=True):
        if value < 0 or value < lo - 1e-9:
            return None
        if hi is not None and value > hi + 1e-9:
            return None

    items = [
        (ing, g)
        for ing, g in zip(ingredients, grams, strict=True)
        if g >= constants.MIN_INGREDIENT_GRAMS
    ]
    if not items:
        return None

    dish = verify(items)
    if dish.ratio is None:
        return None
    if abs(dish.kcal - targets.kcal) > targets.kcal * constants.KCAL_TOLERANCE_FRACTION:
        return None
    if targets.protein_min_g is not None and dish.protein_g < targets.protein_min_g - 1e-9:
        return None
    if targets.carbs_max_g is not None and dish.carbs_g > targets.carbs_max_g + 1e-9:
        return None

    ratio_missed = abs(dish.ratio - targets.ratio) > constants.RATIO_TOLERANCE
    fit = macro_fit(dish, targets.protein_g, targets.net_carbs_g, targets.carbs_max_g)
    split_missed = fit is not None and not fit.within_tolerance
    return ratio_missed, split_missed, _distance(dish, dish.ratio, targets)


def _closest_whole_grams(
    grams: Sequence[float], ingredients: Sequence[Ingredient], targets: Targets
) -> list[float]:
    """Подбирает целочисленные массы рядом с округлённым решением — ближайшие к целям.

    LP решает задачу точно, но массы затем округляются до `GRAM_ROUNDING`, и на
    небольших приёмах пищи это сдвигает соотношение за допуск: при 4:1 и 200 ккал
    решение 23.26/16.53 г округляется в 23/17 г — соотношение 3.85 вместо 4.0,
    хотя рядом есть 24/17 (4.01), укладывающееся и в допуск, и в коридор
    калорийности. Раздел 6.4 ТЗ требует, чтобы `verify(solve(x))` был в допусках.

    До 1.9.0 поиск запускался, только когда округление выводило блюдо за допуск,
    и останавливался на первом составе внутри допуска. Диетолог получала
    «2.9 : 1, −3 ккал до цели» там, где в соседнем грамме лежало «3.0 : 1» — и
    доводила руками то, что подбор обязан был довести сам. Теперь перебор идёт
    всегда и возвращает ближайший к целям состав (`_candidate_rank`).

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
    # Это ЭВРИСТИКА отбора, а не правило расчёта: она решает, кого двигать,
    # и на верность найденного состава не влияет — каждый кандидат проверяется
    # целиком (`_candidate_rank`).
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

    best = base
    best_rank: tuple[bool, bool, float] | None = None

    for combo in product(deltas, repeat=len(movable)):
        candidate = list(base)
        for index, delta in zip(movable, combo, strict=True):
            candidate[index] = max(base[index] + delta, 0.0)

        rank = _candidate_rank(candidate, ingredients, targets)
        if rank is not None and (best_rank is None or rank < best_rank):
            best, best_rank = candidate, rank

    return best


def solve(ingredients: Sequence[Ingredient], targets: Targets) -> SolveResult:
    """Подбирает массы продуктов под цели. Бросает `InfeasibleError`, если задача неразрешима.

    Цели приёма и набранные массы (`protein_g`, `net_carbs_g`, `near_grams`) —
    пожелания: если с ними подбор в целых граммах не сошёлся, он повторяется
    без них. Отказывает только задача, неразрешимая и без пожеланий: иначе
    «подойти ближе к цели» превращалось бы в отказ там, где блюдо есть.
    """

    if not ingredients:
        raise InfeasibleError("Список продуктов пуст — добавьте хотя бы один продукт.")

    # Попытки — от лучшей к запасной. Первая оставляет точному решению запас на
    # округление у минимума белка и лимита углеводов; вторая — без запаса, если
    # с ним задача не решается; третья — без пожеланий вовсе. Причину отказа
    # называет последняя: она про задачу, а не про пожелания.
    plain = replace(targets, protein_g=None, net_carbs_g=None, near_grams=None)
    bounded = targets.protein_min_g is not None or targets.carbs_max_g is not None
    attempts = [(targets, True)] if bounded else []
    attempts.append((targets, False))
    if plain != targets:
        attempts.append((plain, False))

    for attempt, leave_rounding_room in attempts[:-1]:
        try:
            return _judged(_solve(ingredients, attempt, leave_rounding_room), targets)
        except InfeasibleError:
            continue
    last, leave_rounding_room = attempts[-1]
    return _judged(_solve(ingredients, last, leave_rounding_room), targets)


def _judged(result: SolveResult, targets: Targets) -> SolveResult:
    """The result with its split judged against the goals that were asked for."""

    return replace(
        result,
        macro_fit=macro_fit(
            result.dish, targets.protein_g, targets.net_carbs_g, targets.carbs_max_g
        ),
    )


def _solve(
    ingredients: Sequence[Ingredient], targets: Targets, leave_rounding_room: bool
) -> SolveResult:
    def programme(**extra: float | bool | None) -> OptimizeResult:
        return _build_and_solve(
            ingredients,
            targets,
            include_protein=True,
            include_carbs=True,
            include_kcal_corridor=True,
            leave_rounding_room=leave_rounding_room,
            **extra,  # type: ignore[arg-type]
        )

    # Сначала — с раскладкой белка и углеводов в границах её допуска: если
    # такое блюдо есть, оно и ищется. Нет (продукты не дают или мешает лимит
    # углеводов) — раскладка остаётся целью, к которой подходят как можно ближе.
    has_split = targets.protein_g is not None or targets.net_carbs_g is not None
    result = programme(hold_split=True) if has_split else programme()
    hold_split = has_split and bool(result.success)
    if has_split and not hold_split:
        result = programme()

    if not result.success:
        raise InfeasibleError(_diagnose_infeasibility(ingredients, targets))

    # Второй проход: цели уже решены, и из составов, попадающих в них почти так
    # же хорошо, берётся ближайший к набранному. Одним проходом с весами это не
    # сделать: вес близости, достаточный, чтобы удержать овощ, перевесил бы цель
    # по углеводам на приёме из тридцати граммов продуктов.
    if any(ing.product_id in (targets.near_grams or {}) for ing in ingredients):
        nearest = programme(goal_budget=float(result.fun) + _GOAL_SLACK, hold_split=hold_split)
        if nearest.success:
            result = nearest

    grams = result.x[: len(ingredients)]
    rounding = constants.GRAM_ROUNDING
    rounded = [float(g) for g in np.round(grams / rounding) * rounding]

    # Округление до грамма сдвигает и соотношение, и калорийность, и белок с
    # углеводами — из целых составов рядом с точным решением берётся ближайший
    # к целям. До 1.8.0 починка запускалась только по соотношению, и подбор
    # молча отдавал блюдо с белком ниже цели или углеводами выше лимита (аудит
    # расчётов 13.11.2026); до 1.9.0 она останавливалась на первом составе в
    # допуске, а не на ближайшем.
    rounded = _closest_whole_grams(rounded, ingredients, targets)

    items = [
        (ing, g)
        for ing, g in zip(ingredients, rounded, strict=True)
        if g >= constants.MIN_INGREDIENT_GRAMS
    ]

    dish = verify(items)
    ratio_within, kcal_within = within_tolerance(dish, targets)
    if ratio_within is None:
        # У решателя третьего состояния нет: равенство соотношения — само
        # ограничение задачи. Сюда приходит обычный вход, а не поломка: набор
        # «жир плюс овощ, где клетчатка равна углеводам» LP решает, а починка
        # округления валидного кандидата не находит и возвращает исходный.
        # Выдать по такому набору вердикт «не соответствует» значило бы судить о
        # соотношении, которого нет.
        raise InfeasibleError(
            "С выбранными продуктами кетосоотношение не определяется: считать "
            "его не от чего — белка нет, а углеводы целиком уходят в клетчатку."
        )
    # Белок и лимит углеводов — границы, а не допуски: флага для них у
    # результата нет, и блюдо за границей выглядело бы подобранным верно. Если
    # в целых граммах их не удержать, это отказ с причиной, а не результат.
    if targets.protein_min_g is not None and dish.protein_g < targets.protein_min_g - 1e-9:
        raise InfeasibleError(
            f"В целых граммах не удаётся набрать белок {targets.protein_min_g:g} г при "
            f"соотношении {_fmt_ratio(targets.ratio)} и калорийности {targets.kcal:g} ккал — "
            f"ближайший состав даёт {dish.protein_g:.1f} г. Добавьте белковый продукт "
            "или уменьшите цель по белку."
        )
    if targets.carbs_max_g is not None and dish.carbs_g > targets.carbs_max_g + 1e-9:
        raise InfeasibleError(
            f"В целых граммах не удаётся удержать углеводы в лимите {targets.carbs_max_g:g} г "
            f"при соотношении {_fmt_ratio(targets.ratio)} и калорийности {targets.kcal:g} "
            f"ккал — ближайший состав даёт {dish.carbs_g:.1f} г. Замените продукт с "
            "углеводами или увеличьте лимит."
        )
    return SolveResult(
        dish=dish,
        ratio_within_tolerance=ratio_within,
        kcal_within_tolerance=kcal_within,
        macro_fit=macro_fit(dish, targets.protein_g, targets.net_carbs_g, targets.carbs_max_g),
    )
