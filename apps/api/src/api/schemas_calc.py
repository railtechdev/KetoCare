"""Схемы `/calc` — тонкой обёртки над keto_engine (раздел 5.3 ТЗ).

Все ответы включают `engine_version`; бизнес-логики расчётов в API нет.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class IngredientIn(BaseModel):
    """Пищевая ценность на 100 г."""

    model_config = ConfigDict(extra="forbid")

    product_id: str
    kcal: Annotated[float, Field(ge=0)]
    fat: Annotated[float, Field(ge=0)]
    protein: Annotated[float, Field(ge=0)]
    carbs: Annotated[float, Field(ge=0)]
    fiber: Annotated[float, Field(ge=0)] = 0.0


class ItemIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str
    grams: Annotated[float, Field(ge=0)]


class TargetsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ratio: Annotated[float, Field(ge=1.0, le=5.0)]
    kcal: Annotated[float, Field(gt=0, le=5000)]
    protein_min_g: Annotated[float, Field(ge=0)] | None = None
    carbs_max_g: Annotated[float, Field(ge=0)] | None = None
    per_ingredient_bounds: dict[str, tuple[float, float | None]] | None = None
    net_carbs: bool = False


class ItemOut(BaseModel):
    product_id: str
    grams: float


class DishOut(BaseModel):
    items: list[ItemOut]
    kcal: float
    fat_g: float
    protein_g: float
    carbs_g: float
    fiber_g: float
    ratio: float | None
    engine_version: str


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingredients: list[IngredientIn] = Field(min_length=1)
    items: list[ItemIn] = Field(min_length=1)
    targets: TargetsIn | None = Field(
        default=None, description="Если задано — ответ включает соответствие допускам"
    )


class VerifyResponse(BaseModel):
    dish: DishOut
    ratio_within_tolerance: bool | None = None
    kcal_within_tolerance: bool | None = None


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingredients: list[IngredientIn] = Field(min_length=1)
    targets: TargetsIn


class SolveResponse(BaseModel):
    dish: DishOut
    ratio_within_tolerance: bool
    kcal_within_tolerance: bool


class ScaleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingredients: list[IngredientIn] = Field(min_length=1)
    items: list[ItemIn] = Field(min_length=1)
    factor: Annotated[float, Field(gt=0, le=100)]


class ScaleResponse(BaseModel):
    dish: DishOut
