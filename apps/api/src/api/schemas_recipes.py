"""Схемы `/recipes` — общая база рецептов (раздел 4.2, 5.3 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from core.models.enums import RecipeCategory, RecipeStatus

# Столько же, сколько у /calc и своих блюд: рецепт из сотни ингредиентов
# нереалистичен, а без предела состав становится неограниченным по размеру.
MAX_INGREDIENTS = 100


class RecipeIngredientIn(BaseModel):
    """Строка состава. Пищевую ценность клиент не присылает — она берётся из
    `products` в момент расчёта, иначе рецепт можно было бы «посчитать» по
    выдуманным макронутриентам."""

    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
    grams: Annotated[float, Field(gt=0, le=5000)]


class RecipeWrite(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    category: RecipeCategory
    photo_path: str | None = Field(default=None, max_length=512)
    # Границы — из типов колонок (numeric(7,1) и int): за ними СУБД ответила бы
    # ошибкой записи вместо понятного 422.
    yield_g: Annotated[float, Field(gt=0, le=99999.9)]
    servings: Annotated[int, Field(ge=1, le=100)]
    instructions: str = Field(min_length=1, max_length=20000)
    # Пустой состав допустим только у черновика: publish его отклонит.
    ingredients: list[RecipeIngredientIn] = Field(default_factory=list, max_length=MAX_INGREDIENTS)


class RecipeIngredientRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    product_id: uuid.UUID
    grams: float
    position: int


class RecipeComputed(BaseModel):
    """Итоги рецепта, посчитанные ядром (раздел 4.2 ТЗ: `computed jsonb`)."""

    kcal: float
    fat: float
    protein: float
    carbs: float
    fiber: float
    ratio: float | None


class RecipeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    category: RecipeCategory
    photo_path: str | None
    yield_g: float
    servings: int
    instructions: str
    status: RecipeStatus
    computed: RecipeComputed | None
    engine_version: str | None
    author_id: uuid.UUID
    ingredients: list[RecipeIngredientRead]
    created_at: datetime
