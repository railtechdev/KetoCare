"""Итоги дня по меню: сборка состава и вызов расчётного ядра (раздел 5.3 ТЗ).

Арифметики макронутриентов здесь нет. Для каждой позиции состав блюда (рецепт →
`recipe_ingredients`, своё блюдо → `custom_dishes.ingredients`) уходит в
`keto_engine.verify()`, масштабируется `keto_engine.scale()` на множитель порции,
а итог дня — это `verify()` по всем масштабированным составам сразу.

Итоги сохраняются вместе с `ENGINE_VERSION` (раздел 4.1 ТЗ): без версии нельзя
сказать, каким кодом получено сохранённое значение.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.models import CustomDish, Menu, MenuItem, Product, Recipe
from core.models.enums import RecipeStatus
from core.repositories import menus as menus_repo
from core.repositories import products as products_repo
from core.repositories.menus import MenuItemSpec
from keto_engine import ENGINE_VERSION, Ingredient, scale, verify

from ..errors import ApiError, ErrorCode
from ..schemas import DishComputed
from ..schemas_menus import MenuItemRead, MenuItemWrite, MenuRead, WithdrawnProduct
from . import composition as composition_service

# Состав блюда: продукт и его масса в граммах.
type Composition = list[tuple[uuid.UUID, float]]


def to_spec(item: MenuItemWrite) -> MenuItemSpec:
    return MenuItemSpec(
        meal_slot=item.meal_slot,
        recipe_id=item.recipe_id,
        custom_dish_id=item.custom_dish_id,
        portion_factor=item.portion_factor,
    )


async def to_read(session: AsyncSession, menu: Menu, items: Sequence[MenuItem]) -> MenuRead:
    """Позиции хранятся отдельной таблицей, поэтому ответ собирается явно,
    а не `model_validate(menu)`."""

    return MenuRead(
        id=menu.id,
        patient_id=menu.patient_id,
        date=menu.date,
        totals=DishComputed.model_validate(menu.totals) if menu.totals is not None else None,
        engine_version=menu.engine_version,
        items=[MenuItemRead.model_validate(item) for item in items],
        withdrawn_products=await withdrawn_products(session, menu=menu, items=items),
        created_at=menu.created_at,
    )


async def withdrawn_products(
    session: AsyncSession, *, menu: Menu, items: Sequence[MenuItem]
) -> list[WithdrawnProduct]:
    """Продукты дня, выведенные из оборота.

    Состав читается тем же путём, что и при расчёте итогов, но снисходительно:
    рецепт мог быть снят с публикации, своё блюдо — удалено, продукт — исчезнуть
    из базы. Ни один из этих случаев не повод отказать в чтении уже сохранённого
    дня, поэтому проверок, ронявших бы `PUT`, здесь нет.
    """

    recipe_ids = list({item.recipe_id for item in items if item.recipe_id is not None})
    dish_ids = list({item.custom_dish_id for item in items if item.custom_dish_id is not None})

    ingredients = await menus_repo.get_recipe_ingredients(session, recipe_ids=recipe_ids)
    dishes = await menus_repo.get_custom_dishes_by_ids(
        session, patient_id=menu.patient_id, dish_ids=dish_ids
    )

    by_item: dict[uuid.UUID, list[uuid.UUID]] = {}
    for item in items:
        if item.recipe_id is not None:
            by_item[item.id] = [row.product_id for row in ingredients.get(item.recipe_id, [])]
        elif item.custom_dish_id is not None:
            dish = dishes.get(item.custom_dish_id)
            by_item[item.id] = [] if dish is None else [pid for pid, _ in _dish_composition(dish)]

    product_ids = list({pid for ids in by_item.values() for pid in ids})
    products = await products_repo.get_by_ids(session, product_ids=product_ids)

    withdrawn = {pid: product for pid, product in products.items() if not product.is_active}
    if not withdrawn:
        return []

    item_ids: dict[uuid.UUID, list[uuid.UUID]] = {pid: [] for pid in withdrawn}
    for item_id, ids in by_item.items():
        for pid in dict.fromkeys(ids):
            if pid in withdrawn:
                item_ids[pid].append(item_id)

    # Порядок по названию: список показывается человеку, а порядок словаря —
    # порядок запроса к базе, то есть случайный с его точки зрения.
    return sorted(
        (
            WithdrawnProduct(product_id=pid, name_ru=product.name_ru, item_ids=item_ids[pid])
            for pid, product in withdrawn.items()
        ),
        key=lambda entry: entry.name_ru,
    )


async def compute_totals(
    session: AsyncSession, *, patient_id: uuid.UUID, items: Sequence[MenuItemWrite]
) -> tuple[dict[str, Any], str]:
    """Возвращает (totals дня, engine_version) для присланного плана.

    Состав берётся из базы, а не из тела запроса: иначе клиент мог бы прислать
    произвольные макронутриенты и получить «правильные» итоги по выдуманным
    данным — а по этому меню кормят ребёнка.
    """

    compositions, recipes = await _compositions(session, patient_id=patient_id, items=items)
    products = await _products(session, compositions=compositions)

    scaled: list[tuple[Ingredient, float]] = []
    for item, composition in zip(items, compositions, strict=True):
        dish = verify(
            [
                (composition_service.to_ingredient(products[pid]), grams)
                for pid, grams in composition
            ]
        )
        # `portion_factor` — это ЧИСЛО ПОРЦИЙ, а состав рецепта записан на весь
        # выход. Без деления на `servings` множитель 1 означал бы противень:
        # блюдо на четверых уходило в день ребёнка целиком, день сходился как
        # «переедание», и ошибка выглядела бы поведением семьи, а не подстановкой.
        #
        # У своего блюда порция одна по определению: родитель приготовил именно
        # это и именно сейчас. Поэтому знаменатель общий, и поле означает одно и
        # то же в обеих ветках.
        portion = scale(dish, item.portion_factor / _servings(item, recipes))
        scaled.extend((amount.ingredient, amount.grams) for amount in portion.items)

    # Итоги дня считает ядро по всем позициям сразу — складывать показатели
    # блюд руками нельзя: соотношение не аддитивно.
    day = verify(scaled)
    return composition_service.totals_of(day), ENGINE_VERSION


def _servings(item: MenuItemWrite, recipes: dict[uuid.UUID, Recipe]) -> int:
    """На сколько порций рассчитан состав позиции.

    У рецепта это его `servings`; у своего блюда — единица: оно приготовлено под
    конкретный приём пищи, а не как раскладка на семью.
    """

    if item.recipe_id is None:
        return 1
    return recipes[item.recipe_id].servings


async def _compositions(
    session: AsyncSession, *, patient_id: uuid.UUID, items: Sequence[MenuItemWrite]
) -> tuple[list[Composition], dict[uuid.UUID, Recipe]]:
    """Состав каждой позиции в порядке присланного плана и рецепты этих позиций.

    Рецепты возвращаются наружу, а не выбрасываются: по ним считается порция, и
    второй запрос к базе за тем же самым был бы лишним.
    """

    recipes = await _check_recipes(session, items=items)
    ingredients = await menus_repo.get_recipe_ingredients(
        session, recipe_ids=list({item.recipe_id for item in items if item.recipe_id is not None})
    )
    dishes = await _custom_dishes(session, patient_id=patient_id, items=items)

    compositions: list[Composition] = []
    for item in items:
        if item.custom_dish_id is not None:
            compositions.append(_dish_composition(dishes[item.custom_dish_id]))
        elif item.recipe_id is not None:
            compositions.append(
                [(row.product_id, float(row.grams)) for row in ingredients[item.recipe_id]]
            )
        else:
            # Схема MenuItemWrite это исключает. Проверка оставлена, чтобы её
            # ослабление не превратилось в молча неполные итоги дня.
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                "Укажите ровно одно: рецепт или своё блюдо.",
            )
    return compositions, recipes


async def _check_recipes(
    session: AsyncSession, *, items: Sequence[MenuItemWrite]
) -> dict[uuid.UUID, Recipe]:
    """Рецепты позиций. В меню попадают только опубликованные (раздел 5.3 ТЗ):
    черновик — незавершённая работа диетолога, его состав и показатели ещё не
    проверены, а по меню кормят ребёнка.

    Сообщение одно и то же для несуществующего и неопубликованного рецепта:
    иначе по ответу можно было бы установить, что черновик с таким
    идентификатором существует.
    """

    recipe_ids = [item.recipe_id for item in items if item.recipe_id is not None]
    recipes = await menus_repo.get_recipes_by_ids(session, recipe_ids=recipe_ids)

    unusable = sorted(
        {
            str(rid)
            for rid in recipe_ids
            if rid not in recipes or recipes[rid].status is not RecipeStatus.PUBLISHED
        }
    )
    if unusable:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "В меню можно добавлять только опубликованные рецепты.",
            details={"recipe_ids": unusable},
        )

    return recipes


async def _custom_dishes(
    session: AsyncSession, *, patient_id: uuid.UUID, items: Sequence[MenuItemWrite]
) -> dict[uuid.UUID, CustomDish]:
    """Свои блюда позиций. Репозиторий отдаёт только блюда этого пациента,
    поэтому чужое блюдо неотличимо от несуществующего — по ответу нельзя
    установить, что оно есть у кого-то ещё."""

    dish_ids = [item.custom_dish_id for item in items if item.custom_dish_id is not None]
    dishes = await menus_repo.get_custom_dishes_by_ids(
        session, patient_id=patient_id, dish_ids=dish_ids
    )

    missing = sorted({str(did) for did in dish_ids if did not in dishes})
    if missing:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Своё блюдо не найдено у этого пациента.",
            details={"custom_dish_ids": missing},
        )
    return dishes


async def _products(
    session: AsyncSession, *, compositions: Sequence[Composition]
) -> dict[uuid.UUID, Product]:
    product_ids = list(
        {product_id for composition in compositions for product_id, _ in composition}
    )
    return await composition_service.load_products(
        session,
        product_ids=product_ids,
        missing_message="В составе блюд меню указаны продукты, которых нет в базе.",
    )


def _dish_composition(dish: CustomDish) -> Composition:
    """`custom_dishes.ingredients` — jsonb `[{product_id, grams}]` (раздел 4.2 ТЗ)."""

    return [(uuid.UUID(row["product_id"]), float(row["grams"])) for row in dish.ingredients]
