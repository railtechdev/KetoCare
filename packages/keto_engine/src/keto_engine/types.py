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
class SolveResult:
    """Результат подбора масс ингредиентов под цели."""

    dish: DishResult
    ratio_within_tolerance: bool
    kcal_within_tolerance: bool


class InfeasibleError(Exception):
    """Задача подбора масс неразрешима с заданными продуктами/ограничениями.

    `reason` — человекочитаемое объяснение на русском для показа пользователю
    (раздел 8.3 ТЗ: "infeasible показывается человекочитаемой причиной, не ошибкой").
    """

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)
