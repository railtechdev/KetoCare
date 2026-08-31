"""Репозиторий меню дня и его позиций (раздел 4.2 «Питание и дневники», 5.3 ТЗ).

`totals`/`engine_version` репозиторий только сохраняет — считает их
исключительно расчётное ядро (правило 2 CLAUDE.md).

Мягкое удаление: позиция, выпавшая из плана дня, физически не удаляется
(правило 4 CLAUDE.md) — на неё может ссылаться `meal_logs.menu_item_id`.
Выборки отсекают `deleted_at is not null`.
"""

from __future__ import annotations

import uuid
from collections import defaultdict, deque
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import CustomDish, Menu, MenuItem, Recipe, RecipeIngredient
from ..models.enums import MealSlot

# Ключ, по которому позиция плана считается «той же самой» при пересохранении дня.
type _ItemKey = tuple[MealSlot, uuid.UUID | None, uuid.UUID | None]


@dataclass(frozen=True, slots=True)
class MenuItemSpec:
    """Позиция плана дня: приём пищи, блюдо и множитель порции (раздел 4.2 ТЗ)."""

    meal_slot: MealSlot
    recipe_id: uuid.UUID | None
    custom_dish_id: uuid.UUID | None
    portion_factor: float
    #: Состав и показатели блюда на момент сохранения. Собирает сервис: состав
    #: читается из рецептов и продуктов, а репозиторий меню в чужие таблицы не
    #: ходит.
    snapshot: dict[str, Any] | None = None


async def get_by_date(
    session: AsyncSession, *, patient_id: uuid.UUID, menu_date: date
) -> Menu | None:
    menu: Menu | None = await session.scalar(
        select(Menu).where(
            Menu.patient_id == patient_id,
            Menu.date == menu_date,
            Menu.deleted_at.is_(None),
        )
    )
    return menu


async def list_items(session: AsyncSession, *, menu_id: uuid.UUID) -> list[MenuItem]:
    """Позиции меню в порядке приёмов пищи.

    Сортировка по `meal_slot` — это порядок значений в enum-типе (`breakfast`,
    `lunch`, `dinner`, `snack`), то есть порядок дня. Внутри приёма — по времени
    добавления: колонки `position` раздел 4.2 у `menu_items` не предусматривает.
    """

    stmt = (
        select(MenuItem)
        .where(MenuItem.menu_id == menu_id, MenuItem.deleted_at.is_(None))
        .order_by(MenuItem.meal_slot, MenuItem.created_at, MenuItem.id)
    )
    return list(await session.scalars(stmt))


async def recent_product_ids(
    session: AsyncSession, *, patient_id: uuid.UUID, days: int = 30, limit: int = 200
) -> list[uuid.UUID]:
    """Продукты, которые семья уже клала в дни ребёнка, — от свежих к старым.

    Источник — снимки позиций меню (ADR-0016): в них лежит состав ровно тот,
    по которому считался день, и лишних запросов к рецептам не нужно.
    Позиции без снимка (сохранённые до его появления) просто не участвуют.

    Порядок — по времени добавления позиции: «недавние» это про то, что семья
    готовила последним, а не про алфавит.
    """

    since = datetime.now(UTC) - timedelta(days=days)
    stmt = (
        select(MenuItem.snapshot)
        .where(
            MenuItem.patient_id == patient_id,
            MenuItem.deleted_at.is_(None),
            MenuItem.snapshot.is_not(None),
            MenuItem.created_at >= since,
        )
        .order_by(MenuItem.created_at.desc())
        .limit(limit)
    )

    seen: dict[uuid.UUID, None] = {}
    for snapshot in await session.scalars(stmt):
        for row in (snapshot or {}).get("ingredients", []):
            try:
                seen.setdefault(uuid.UUID(str(row["product_id"])), None)
            except (KeyError, ValueError):
                continue
    return list(seen)


async def get_item(session: AsyncSession, item_id: uuid.UUID) -> MenuItem | None:
    item: MenuItem | None = await session.scalar(
        select(MenuItem).where(MenuItem.id == item_id, MenuItem.deleted_at.is_(None))
    )
    return item


async def upsert(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    menu_date: date,
    totals: dict[str, Any] | None = None,
    engine_version: str | None = None,
    created_by: uuid.UUID | None,
) -> Menu:
    """Меню дня одно: `unique(patient_id, date)` (раздел 4.2 ТЗ).

    ON CONFLICT, а не «прочитать, затем вставить»: два одновременных сохранения
    одного дня (повторный тап в приложении, веб и бот одновременно) во втором
    случае дали бы нарушение уникальности вместо сохранённого меню.

    `deleted_at` сбрасывается, потому что уникальность мягкое удаление не
    учитывает: иначе однажды удалённый день нельзя было бы составить заново.
    `created_by` при конфликте не трогаем — автором остаётся тот, кто завёл день.

    Итоги необязательны: они считаются по снимкам уже сохранённых позиций, то
    есть после `replace_items`, и проставляются `set_totals` в той же
    транзакции.
    """

    stmt = (
        insert(Menu)
        .values(
            patient_id=patient_id,
            date=menu_date,
            totals=totals,
            engine_version=engine_version,
            created_by=created_by,
        )
        .on_conflict_do_update(
            constraint="uq_menu_patient_date",
            set_={
                "totals": totals,
                "engine_version": engine_version,
                "deleted_at": None,
                # `onupdate` к ON CONFLICT-обновлению не применяется — время правки
                # проставляется явно, иначе `updated_at` осталось бы от вставки.
                "updated_at": func.now(),
            },
        )
        .returning(Menu)
    )
    result = await session.scalars(stmt, execution_options={"populate_existing": True})
    return result.one()


async def set_totals(
    session: AsyncSession, *, menu: Menu, totals: dict[str, Any], engine_version: str
) -> Menu:
    """Итоги дня и версия ядра, которой они получены (раздел 4.1 ТЗ).

    Отдельным шагом от `upsert`, потому что считаются по снимкам позиций: до
    `replace_items` неизвестно, какие позиции переиспользованы, а у
    переиспользованных снимок остаётся прежним — в этом и смысл снимка.
    """

    menu.totals = totals
    menu.engine_version = engine_version
    await session.flush()
    return menu


async def replace_items(
    session: AsyncSession,
    *,
    menu: Menu,
    patient_id: uuid.UUID,
    items: Sequence[MenuItemSpec],
    created_by: uuid.UUID | None,
) -> list[MenuItem]:
    """Заменяет состав дня целиком (PUT — upsert дня, раздел 5.3 ТЗ).

    Позиция, совпавшая с сохранённой по приёму пищи и блюду, переиспользуется:
    иначе повторное сохранение дня (семья добавила ужин вечером) сбрасывало бы
    отметки «съедено», проставленные утром, и оставляло бы записи дневника еды
    ссылаться на удалённую позицию. Меняется у такой позиции только множитель
    порции. Всё, что в новый план не попало, удаляется мягко.

    Снимок состава у переиспользованной позиции НЕ обновляется: он и существует
    затем, чтобы правка рецепта не меняла уже сохранённый день. Исключение —
    позиция, сохранённая до появления снимков: у неё снимка нет, и первое же
    сохранение дня его берёт.
    """

    reusable: dict[_ItemKey, deque[MenuItem]] = defaultdict(deque)
    for stored in await list_items(session, menu_id=menu.id):
        reusable[_item_key(stored.meal_slot, stored.recipe_id, stored.custom_dish_id)].append(
            stored
        )

    for spec in items:
        bucket = reusable.get(_item_key(spec.meal_slot, spec.recipe_id, spec.custom_dish_id))
        if bucket:
            kept = bucket.popleft()
            kept.portion_factor = spec.portion_factor
            if kept.snapshot is None:
                kept.snapshot = spec.snapshot
            continue

        session.add(
            MenuItem(
                menu_id=menu.id,
                patient_id=patient_id,
                meal_slot=spec.meal_slot,
                recipe_id=spec.recipe_id,
                custom_dish_id=spec.custom_dish_id,
                portion_factor=spec.portion_factor,
                snapshot=spec.snapshot,
                eaten=False,
                created_by=created_by,
            )
        )

    now = datetime.now(UTC)
    for bucket in reusable.values():
        for dropped in bucket:
            dropped.deleted_at = now

    await session.flush()
    return await list_items(session, menu_id=menu.id)


async def set_eaten(session: AsyncSession, *, item: MenuItem, eaten: bool) -> MenuItem:
    """Меняет только флаг: итоги дня считаются по плану, а не по факту съеденного."""

    item.eaten = eaten
    await session.flush()
    return item


async def get_recipes_by_ids(
    session: AsyncSession, *, recipe_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, Recipe]:
    """Рецепты для расчёта итогов. Статус проверяет вызывающая сторона."""

    if not recipe_ids:
        return {}

    rows = await session.scalars(select(Recipe).where(Recipe.id.in_(list(recipe_ids))))
    return {recipe.id: recipe for recipe in rows}


async def get_recipe_ingredients(
    session: AsyncSession, *, recipe_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[RecipeIngredient]]:
    """Состав сразу для всех рецептов дня — одним запросом вместо запроса на позицию."""

    if not recipe_ids:
        return {}

    stmt = (
        select(RecipeIngredient)
        .where(RecipeIngredient.recipe_id.in_(list(recipe_ids)))
        .order_by(RecipeIngredient.recipe_id, RecipeIngredient.position)
    )
    grouped: dict[uuid.UUID, list[RecipeIngredient]] = {rid: [] for rid in recipe_ids}
    for row in await session.scalars(stmt):
        grouped.setdefault(row.recipe_id, []).append(row)
    return grouped


async def get_custom_dishes_by_ids(
    session: AsyncSession, *, patient_id: uuid.UUID, dish_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, CustomDish]:
    """Свои блюда этого пациента. Чужие и удалённые не возвращаются вовсе —
    так в меню ребёнка не может попасть блюдо, составленное для другого."""

    if not dish_ids:
        return {}

    rows = await session.scalars(
        select(CustomDish).where(
            CustomDish.id.in_(list(dish_ids)),
            CustomDish.patient_id == patient_id,
            CustomDish.deleted_at.is_(None),
        )
    )
    return {dish.id: dish for dish in rows}


def _item_key(
    meal_slot: MealSlot, recipe_id: uuid.UUID | None, custom_dish_id: uuid.UUID | None
) -> _ItemKey:
    return (meal_slot, recipe_id, custom_dish_id)
