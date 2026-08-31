"""Схемы меню дня (раздел 4.2 «Питание и дневники», раздел 5.3 ТЗ).

`totals` и `engine_version` в схемах записи отсутствуют намеренно: итоги дня
считает расчётное ядро по составу блюд, а не присылает клиент. Иначе меню несло
бы показатели, не соответствующие тому, что ребёнок съест.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from core.models.enums import MealSlot

from .schemas import DishComputed

# Технические, а не медицинские границы. Сколько блюд бывает в дне и насколько
# крупной бывает порция, ТЗ не задаёт (правило 1 CLAUDE.md), поэтому здесь только
# то, что защищает БД и расчёт: множитель обязан помещаться в numeric(4,2), а
# день — не превращаться в список на тысячи позиций, каждая из которых считается.
MAX_MENU_ITEMS = 50
MAX_PORTION_FACTOR = 99.99
PORTION_FACTOR_STEP = Decimal("0.01")


def _quantize_portion_factor(value: float) -> float:
    """Приводит множитель порции к точности колонки `numeric(4,2)`.

    Округление до записи, а не после: иначе итоги дня считались бы по 0.125, а в
    базу легло бы 0.13 — сохранённые показатели не соответствовали бы
    сохранённому плану. Правило округления то же, что у PostgreSQL (half-up),
    чтобы результат совпадал с тем, что положит в колонку сама БД.
    """

    quantized = Decimal(str(value)).quantize(PORTION_FACTOR_STEP, rounding=ROUND_HALF_UP)
    if quantized <= 0:
        raise ValueError(f"Множитель порции меньше минимального шага {PORTION_FACTOR_STEP}")
    return float(quantized)


class MenuItemWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    meal_slot: MealSlot
    recipe_id: uuid.UUID | None = None
    custom_dish_id: uuid.UUID | None = None
    portion_factor: Annotated[
        float, Field(gt=0, le=MAX_PORTION_FACTOR), AfterValidator(_quantize_portion_factor)
    ] = 1.0

    @model_validator(mode="after")
    def _exactly_one_source(self) -> MenuItemWrite:
        """Позиция ссылается либо на рецепт, либо на своё блюдо (раздел 4.2 ТЗ).

        Обе ссылки сразу — непонятно, что именно попадает в итоги дня; ни одной —
        считать нечего, а в плане появилась бы пустая строка.
        """

        if (self.recipe_id is None) == (self.custom_dish_id is None):
            raise ValueError("Укажите ровно одно: recipe_id или custom_dish_id")
        return self


class MenuWrite(BaseModel):
    """Меню дня сохраняется целиком: PUT задаёт весь состав дня (раздел 5.3 ТЗ)."""

    model_config = ConfigDict(extra="forbid")

    date: date
    items: list[MenuItemWrite] = Field(min_length=1, max_length=MAX_MENU_ITEMS)


class MenuItemEatenWrite(BaseModel):
    """Отметка «съедено». Снятие отметки нужно так же, как и простановка:
    ошибочное нажатие иначе осталось бы в данных навсегда — отдельной ручки
    изменения позиции меню раздел 5.3 не предусматривает."""

    model_config = ConfigDict(extra="forbid")

    eaten: bool = True


class MenuItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    menu_id: uuid.UUID
    patient_id: uuid.UUID
    meal_slot: MealSlot
    recipe_id: uuid.UUID | None
    custom_dish_id: uuid.UUID | None
    portion_factor: float
    eaten: bool


class WithdrawnProduct(BaseModel):
    """Продукт, выведенный из оборота, но оставшийся в составе блюд этого дня.

    Вывод продукта (`is_active = false`) убирает его из поиска, но НЕ из уже
    сохранённых рецептов, своих блюд и меню — и правильно: история должна
    считаться так же, как считалась. Плохо было другое: об этом никто не узнавал.
    Позиция продолжала участвовать в итогах дня без единой пометки, а вывели её
    чаще всего потому, что числа оказались неверными.

    Запрета здесь нет и не будет: убрать блюдо из прошлого дня — значит подменить
    то, чем ребёнка кормили на самом деле.
    """

    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
    name_ru: str
    #: Позиции меню, в составе которых он встретился.
    item_ids: list[uuid.UUID]


class MenuRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    date: date
    # Набор показателей у итогов дня тот же, что у блюда (kcal/fat/protein/carbs/
    # fiber/ratio), поэтому схема переиспользуется, а не копируется.
    totals: DishComputed | None
    engine_version: str | None
    items: list[MenuItemRead]
    #: Считается на чтении, а не хранится: продукт выводят из оборота уже после
    #: того, как день сохранён, и сохранённая пометка молчала бы ровно в том
    #: случае, ради которого нужна.
    withdrawn_products: list[WithdrawnProduct] = []
    created_at: datetime
