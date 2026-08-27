"""Схемы `/calc` — тонкой обёртки над keto_engine (раздел 5.3 ТЗ).

Все ответы включают `engine_version`; бизнес-логики расчётов в API нет.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

# Верхняя граница размера задачи. Блюдо из сотни ингредиентов нереалистично,
# а без предела один запрос со списком на десятки тысяч позиций занял бы решатель
# надолго (LP решается синхронно).
MAX_INGREDIENTS = 100


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
    per_ingredient_bounds: (
        Annotated[dict[str, tuple[float, float | None]], Field(max_length=MAX_INGREDIENTS)] | None
    ) = None
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

    ingredients: list[IngredientIn] = Field(min_length=1, max_length=MAX_INGREDIENTS)
    items: list[ItemIn] = Field(min_length=1, max_length=MAX_INGREDIENTS)
    targets: TargetsIn | None = Field(
        default=None, description="Если задано — ответ включает соответствие допускам"
    )


class VerifyResponse(BaseModel):
    dish: DishOut
    ratio_within_tolerance: bool | None = None
    kcal_within_tolerance: bool | None = None


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingredients: list[IngredientIn] = Field(min_length=1, max_length=MAX_INGREDIENTS)
    targets: TargetsIn


class SolveResponse(BaseModel):
    dish: DishOut
    ratio_within_tolerance: bool
    kcal_within_tolerance: bool


class ScaleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingredients: list[IngredientIn] = Field(min_length=1, max_length=MAX_INGREDIENTS)
    items: list[ItemIn] = Field(min_length=1, max_length=MAX_INGREDIENTS)
    factor: Annotated[float, Field(gt=0, le=100)]


class ScaleResponse(BaseModel):
    dish: DishOut
