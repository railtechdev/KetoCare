"""Изолированное расчётное ядро KetoCare (раздел 6 ТЗ). Никаких импортов из core/api."""

from .constants import ENGINE_VERSION
from .engine import (
    dietary_unit_kcal,
    energy_requirement,
    fluid_requirement,
    max_non_fat_grams,
    meal_macro_goal,
    protein_requirement,
    scale,
    solve,
    verify,
    within_tolerance,
)
from .types import (
    DishResult,
    InfeasibleError,
    Ingredient,
    ItemAmount,
    MealMacroGoal,
    SolveResult,
    Targets,
)

__all__ = [
    "ENGINE_VERSION",
    "dietary_unit_kcal",
    "energy_requirement",
    "fluid_requirement",
    "protein_requirement",
    "DishResult",
    "Ingredient",
    "InfeasibleError",
    "ItemAmount",
    "MealMacroGoal",
    "SolveResult",
    "Targets",
    "max_non_fat_grams",
    "meal_macro_goal",
    "scale",
    "solve",
    "verify",
    "within_tolerance",
]
