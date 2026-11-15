"""Типы данных контракта расчётного ядра (раздел 6.1 ТЗ). Никакого I/O."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Ingredient:
    """Пищевая ценность продукта на 100 г."""

    product_id: str
    kcal: float
    fat: float
    protein: float
    carbs: float
    fiber: float = 0.0


@dataclass(frozen=True, slots=True)
class Targets:
    """Цели расчёта: кетосоотношение, калорийность и опциональные ограничения."""

    ratio: float
    kcal: float
    protein_min_g: float | None = None
    #: Лимит углеводов — по ОБЩИМ углеводам, включая клетчатку (ответ клиники,
    #: вопрос 3). Соотношение при этом считается по чистым: две величины
    #: намеренно считаются по-разному, см. `constants`.
    carbs_max_g: float | None = None
    per_ingredient_bounds: dict[str, tuple[float, float | None]] | None = None
    #: Protein and net carbs the dish should come to: the meal's goal from
    #: `meal_macro_goal()`. Goals, not bounds: the solver gets as close as the
    #: products and the hard limits above allow, and a dish that solves without
    #: them is never refused because of them. Without them the split of protein
    #: against carbs is whatever satisfies the ratio, which is how a meal came
    #: out with twice the protein and a fifth of the carbs (ADR-0083).
    protein_g: float | None = None
    net_carbs_g: float | None = None
    #: Masses to stay close to, by product: the composition the person entered.
    #: A preference far weaker than any goal: of the compositions that reach the
    #: goals equally well the solver returns the one that moves the fewest
    #: grams. Without it the answer is a corner of the feasible region, and a
    #: dish adjusted by hand jumped to different products' bounds on each run.
    near_grams: dict[str, float] | None = None


@dataclass(frozen=True, slots=True)
class ItemAmount:
    """Ингредиент, его масса (г) и вклад этой массы в показатели блюда.

    Вклад считает только `verify()`: у полей нет умолчаний намеренно, чтобы
    собранная руками позиция с нулями не сошла за посчитанную. Сумма вкладов
    по позициям равна итогам `DishResult` — итоги и считаются как эта сумма.
    """

    ingredient: Ingredient
    grams: float
    kcal: float
    fat_g: float
    protein_g: float
    carbs_g: float
    fiber_g: float
    net_carbs_g: float


@dataclass(frozen=True, slots=True)
class DishResult:
    """Итоговые показатели блюда/рецепта — то, что хранится в `computed jsonb`
    (раздел 4.2 ТЗ: `{kcal, fat, protein, carbs, ratio}`)."""

    items: tuple[ItemAmount, ...]
    kcal: float
    fat_g: float
    protein_g: float
    #: Все углеводы, вместе с клетчаткой. По ним считается лимит из назначения.
    carbs_g: float
    fiber_g: float
    #: Углеводы за вычетом клетчатки — то, по чему считается соотношение.
    #:
    #: Отдельным полем, а не выводится на экране вычитанием: соотношение
    #: перестало следовать из показанных углеводов, и врач должен видеть число,
    #: из которого оно получено, иначе проверить его нечем.
    net_carbs_g: float
    ratio: float | None
    engine_version: str = ""


@dataclass(frozen=True, slots=True)
class MacroFit:
    """A dish against the protein and net carbs goals of its meal.

    The deltas are fact minus goal, in grams: positive is more than the goal.
    A delta is `None` when that goal was not given.

    The goal a dish is measured against is the one that fits under the carbs
    limit. The limit counts ALL carbs and the goal counts net carbs, so the
    fibre of the dish takes room from the goal: `carbs_limited_by_g` is how
    many grams of the carbs goal did not fit, and the protein goal is higher by
    the same amount, because the ratio and the calories fix their sum.
    """

    protein_delta_g: float | None
    net_carbs_delta_g: float | None
    #: Grams of the net carbs goal that the carbs limit leaves no room for with
    #: this dish's fibre; zero when the goal fits or there is no limit.
    carbs_limited_by_g: float
    #: Every given goal is met within `constants.MEAL_MACRO_TOLERANCE_G`.
    within_tolerance: bool


@dataclass(frozen=True, slots=True)
class SolveResult:
    """Результат подбора масс ингредиентов под цели."""

    dish: DishResult
    ratio_within_tolerance: bool
    kcal_within_tolerance: bool
    #: How the dish sits against the protein and net carbs goals; `None` when
    #: the targets carried neither.
    macro_fit: MacroFit | None = None


class InfeasibleError(Exception):
    """Задача подбора масс неразрешима с заданными продуктами/ограничениями.

    `reason` — человекочитаемое объяснение на русском для показа пользователю
    (раздел 8.3 ТЗ: "infeasible показывается человекочитаемой причиной, не ошибкой").
    """

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True, slots=True)
class MealMacroGoal:
    """Grams one meal should contain to hit its ratio and calories.

    `protein_g` and `net_carbs_g` are `None` when the split is unknown: no daily
    protein target was given, or that protein does not fit this meal's ratio.
    """

    fat_g: float
    protein_g: float | None
    net_carbs_g: float | None
    #: Protein plus net carbs, the denominator of the ketogenic ratio.
    non_fat_g: float
