"""Схемы `/calc` — тонкой обёртки над keto_engine (раздел 5.3 ТЗ).

Все ответы включают `engine_version`; бизнес-логики расчётов в API нет.
"""

from __future__ import annotations

import uuid
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


class ExcludedProductOut(BaseModel):
    """Продукт, который ребёнку исключён.

    Раздел 6.3 ТЗ говорит, что исключённые продукты не попадают на вход
    решателя и «фильтрует вызывающая сторона». Вызывающей стороны не было:
    `/calc` не знал пациента вовсе, и ребёнку с аллергией на орехи решатель мог
    предложить арахис.
    """

    product_id: str
    #: Название — из каталога; у свободной метки его нет, и она сюда не попадает.
    name_ru: str | None = None


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
    #: Чей это расчёт.
    #:
    #: Нужен ради исключений ребёнка: без него `/calc` не знает пациента вовсе,
    #: и «фильтрует вызывающая сторона» из раздела 6.3 ТЗ остаётся ничьей
    #: обязанностью. Необязателен: калькулятором пользуются и без выбранного
    #: ребёнка — например, диетолог, разбирающий рецепт.
    #:
    #: Доступ к пациенту проверяется отдельно: чужой идентификатор в теле
    #: запроса даёт 403, как и везде (правило 5 CLAUDE.md).
    patient_id: uuid.UUID | None = None


class VerifyResponse(BaseModel):
    dish: DishOut
    ratio_within_tolerance: bool | None = None
    kcal_within_tolerance: bool | None = None
    #: Продукты состава, исключённые этому ребёнку.
    #:
    #: Состав задал человек, и подменять его молча нельзя — поэтому проверка
    #: считает как есть и говорит, что не так. Запрещать или предупреждать —
    #: вопрос медицинской команды (вопрос 29 в OPEN_QUESTIONS.md); до ответа
    #: предупреждение.
    excluded: list[ExcludedProductOut] = []


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingredients: list[IngredientIn] = Field(min_length=1, max_length=MAX_INGREDIENTS)
    targets: TargetsIn
    #: Чей это подбор.
    #:
    #: Здесь он важнее, чем в проверке: подбор САМ выбирает, из чего составить
    #: блюдо. Оставить исключённый продукт на входе — значит позволить решателю
    #: предложить его ребёнку, и человеку останется заметить это глазами.
    #: Доступ к пациенту проверяется, чужой идентификатор даёт 403.
    patient_id: uuid.UUID | None = None


class SolveResponse(BaseModel):
    dish: DishOut
    ratio_within_tolerance: bool
    kcal_within_tolerance: bool
    #: Продукты, снятые со входа как исключённые ребёнку.
    #:
    #: Молчаливое исключение было бы не лучше молчаливого включения: человек
    #: должен видеть, что решатель работал не со всем набором.
    excluded: list[ExcludedProductOut] = []


class ScaleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ingredients: list[IngredientIn] = Field(min_length=1, max_length=MAX_INGREDIENTS)
    items: list[ItemIn] = Field(min_length=1, max_length=MAX_INGREDIENTS)
    factor: Annotated[float, Field(gt=0, le=100)]


class ScaleResponse(BaseModel):
    dish: DishOut
