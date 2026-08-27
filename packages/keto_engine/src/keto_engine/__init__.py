"""Изолированное расчётное ядро KetoCare (раздел 6 ТЗ). Никаких импортов из core/api."""

from .constants import ENGINE_VERSION
from .engine import scale, solve, verify, within_tolerance
from .types import (
    DishResult,
    InfeasibleError,
    Ingredient,
    ItemAmount,
    SolveResult,
    Targets,
)

__all__ = [
    "ENGINE_VERSION",
    "DishResult",
    "Ingredient",
    "InfeasibleError",
    "ItemAmount",
    "SolveResult",
    "Targets",
    "scale",
    "solve",
    "verify",
    "within_tolerance",
]
