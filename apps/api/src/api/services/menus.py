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

from core import exclusions
from core.models import CustomDish, Menu, MenuItem, Product, Recipe
from core.models.enums import RecipeStatus
from core.repositories import menus as menus_repo
from core.repositories import patients as patients_repo
from core.repositories import products as products_repo
from core.repositories.menus import MenuItemSpec
from keto_engine import ENGINE_VERSION, Ingredient, scale, verify

from ..errors import ApiError, ErrorCode
from ..schemas import DishComputed
from ..schemas_menus import (
    MenuItemIngredient,
    MenuItemRead,
    MenuItemWrite,
    MenuRead,
    WithdrawnProduct,
)
from . import composition as composition_service

# Состав блюда: продукт и его масса в граммах.
type Composition = list[tuple[uuid.UUID, float]]


def to_spec(item: MenuItemWrite, snapshot: dict[str, Any] | None = None) -> MenuItemSpec:
    return MenuItemSpec(
        meal_slot=item.meal_slot,
        recipe_id=item.recipe_id,
        custom_dish_id=item.custom_dish_id,
        portion_factor=item.portion_factor,
        snapshot=snapshot,
    )


async def to_read(session: AsyncSession, menu: Menu, items: Sequence[MenuItem]) -> MenuRead:
    """Позиции хранятся отдельной таблицей, поэтому ответ собирается явно,
    а не `model_validate(menu)`."""

    live = await _live_compositions(session, menu=menu, items=items)

    return MenuRead(
        id=menu.id,
        patient_id=menu.patient_id,
        date=menu.date,
        totals=DishComputed.model_validate(menu.totals) if menu.totals is not None else None,
        engine_version=menu.engine_version,
        items=[
            MenuItemRead(
                **MenuItemRead.model_validate(item).model_dump(
                    exclude={
                        "title",
                        "ingredients",
                        "has_snapshot",
                        "changed_since_saved",
                    }
                ),
                title=None if item.snapshot is None else item.snapshot.get("title"),
                ingredients=_snapshot_ingredients(item),
                has_snapshot=item.snapshot is not None,
                changed_since_saved=_changed_since_saved(item, live.get(item.id, [])),
            )
            for item in items
        ],
        withdrawn_products=_withdrawn_products(items, live),
        excluded_products=await _excluded_products(session, menu=menu, items=items, live=live),
        created_at=menu.created_at,
    )


def _snapshot_ingredients(item: MenuItem) -> list[MenuItemIngredient]:
    """Состав позиции из снимка: что и сколько взвесить НА ЭТУ ПОЗИЦИЮ.

    Из меню нельзя было открыть блюдо и увидеть граммовку — приходилось искать
    рецепт в другом разделе и надеяться, что он с тех пор не изменился. Снимок
    отвечает на этот вопрос точно, потому что и создан для этого.

    Граммовка масштабируется здесь, на сервере: снимок хранит раскладку ВСЕГО
    рецепта и его `servings`, а клиент числа порций не видит и отмасштабировать
    не может. Кабинет умножал сырую раскладку на `portion_factor` без деления
    на порции — рецепт на четверых при одной порции предлагал взвесить 200 г
    масла вместо 50 г. Итоги дня при этом считались верно (`totals_from_items`
    делит на `servings`) — расходились именно граммы у плиты. Тесты дефекта не
    видели по той же причине, что в ADR-0015: рецепт на одну порцию и своё
    блюдо (у него `servings` = 1) дают правильный ответ и при неправильной
    формуле.
    """

    if item.snapshot is None:
        return []

    scale = float(item.portion_factor) / int(item.snapshot.get("servings", 1))
    return [
        MenuItemIngredient(
            product_id=uuid.UUID(str(row["product_id"])),
            name_ru=str(row.get("name_ru", "")),
            grams=float(row["grams"]) * scale,
        )
        for row in item.snapshot.get("ingredients", [])
    ]


async def _excluded_products(
    session: AsyncSession,
    *,
    menu: Menu,
    items: Sequence[MenuItem],
    live: dict[uuid.UUID, list[tuple[uuid.UUID, float, Product]]],
) -> list[WithdrawnProduct]:
    """Продукты дня, исключённые этому ребёнку.

    Раздел 6.3 ТЗ говорит об исключениях на входе расчёта, но план дня — то же
    самое другими словами: по нему кормят. Исключения уточняются по ходу
    терапии, и вчерашний план мог быть согласован с врачом, поэтому день не
    запрещается и не подменяется — он только помечается.
    """

    patient = await patients_repo.get(session, menu.patient_id)
    if patient is None or not patient.allergies:
        return []

    by_item = _product_ids_by_item(items, live)
    names = {pid: product.name_ru for rows in live.values() for pid, _, product in rows}

    excluded = exclusions.excluded_ids(patient.allergies)
    item_ids: dict[uuid.UUID, list[uuid.UUID]] = {}
    for item_id, ids in by_item.items():
        for pid in dict.fromkeys(ids):
            if pid in excluded:
                item_ids.setdefault(pid, []).append(item_id)

    if not item_ids:
        return []

    snapshot_names = {
        uuid.UUID(str(row["product_id"])): str(row["name_ru"])
        for item in items
        if item.snapshot is not None
        for row in item.snapshot["ingredients"]
    }

    return sorted(
        (
            WithdrawnProduct(
                product_id=pid,
                # Название из каталога, а при его отсутствии — из снимка дня:
                # продукт мог исчезнуть, а сказать, чем кормили, всё равно надо.
                name_ru=names.get(pid) or snapshot_names.get(pid, str(pid)),
                item_ids=ids,
            )
            for pid, ids in item_ids.items()
        ),
        key=lambda entry: entry.name_ru,
    )


def _changed_since_saved(item: MenuItem, live: list[tuple[uuid.UUID, float, Product]]) -> bool:
    """Блюдо изменилось с того дня, когда его сохранили?

    Сравнивается снимок с тем, что рецепт (или своё блюдо) представляет собой
    сейчас: состав, граммовки и значения продуктов на 100 г. День от этого не
    меняется — в том и смысл снимка, — но знать об этом надо: рецепт правят,
    когда в нём нашли ошибку, и семье решать, пересобрать день или оставить.

    У позиции без снимка сравнивать не с чем: она сохранена до появления
    снимков, и её состав и так читается по ссылке.
    """

    snapshot = item.snapshot
    if snapshot is None:
        return False

    saved = [
        (
            str(row["product_id"]),
            float(row["grams"]),
            float(row["kcal_100g"]),
            float(row["fat_100g"]),
            float(row["protein_100g"]),
            float(row["carbs_100g"]),
            float(row["fiber_100g"]),
        )
        for row in snapshot["ingredients"]
    ]
    current = [
        (
            str(product_id),
            float(grams),
            float(product.kcal_100g),
            float(product.fat_100g),
            float(product.protein_100g),
            float(product.carbs_100g),
            float(product.fiber_100g),
        )
        for product_id, grams, product in live
    ]
    return saved != current


async def _live_compositions(
    session: AsyncSession, *, menu: Menu, items: Sequence[MenuItem]
) -> dict[uuid.UUID, list[tuple[uuid.UUID, float, Product]]]:
    """Состав каждой позиции ТАКОЙ, КАКОЙ ОН СЕЙЧАС, с продуктами.

    Читается снисходительно: рецепт мог быть снят с публикации, своё блюдо —
    удалено, продукт — исчезнуть из базы. Ни один из этих случаев не повод
    отказать в чтении уже сохранённого дня, поэтому проверок, ронявших бы
    `PUT`, здесь нет.

    Один проход на оба вопроса чтения: какие продукты выведены из оборота и
    изменилось ли блюдо с того дня, когда его сохранили.
    """

    recipe_ids = list({item.recipe_id for item in items if item.recipe_id is not None})
    dish_ids = list({item.custom_dish_id for item in items if item.custom_dish_id is not None})

    ingredients = await menus_repo.get_recipe_ingredients(session, recipe_ids=recipe_ids)
    dishes = await menus_repo.get_custom_dishes_by_ids(
        session, patient_id=menu.patient_id, dish_ids=dish_ids
    )

    raw: dict[uuid.UUID, list[tuple[uuid.UUID, float]]] = {}
    for item in items:
        if item.recipe_id is not None:
            raw[item.id] = [
                (row.product_id, float(row.grams)) for row in ingredients.get(item.recipe_id, [])
            ]
        elif item.custom_dish_id is not None:
            dish = dishes.get(item.custom_dish_id)
            raw[item.id] = [] if dish is None else _dish_composition(dish)

    product_ids = list({pid for rows in raw.values() for pid, _ in rows})
    products = await products_repo.get_by_ids(session, product_ids=product_ids)

    return {
        item_id: [(pid, grams, products[pid]) for pid, grams in rows if pid in products]
        for item_id, rows in raw.items()
    }


def _product_ids_by_item(
    items: Sequence[MenuItem],
    live: dict[uuid.UUID, list[tuple[uuid.UUID, float, Product]]],
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Продукты каждой позиции дня.

    У позиции со снимком берутся продукты СНИМКА: именно по ним посчитаны итоги
    этого дня, а живой состав рецепта мог с тех пор смениться целиком.
    """

    by_item: dict[uuid.UUID, list[uuid.UUID]] = {}
    for item in items:
        if item.snapshot is not None:
            by_item[item.id] = [
                uuid.UUID(str(row["product_id"])) for row in item.snapshot["ingredients"]
            ]
        else:
            by_item[item.id] = [pid for pid, _, _ in live.get(item.id, [])]
    return by_item


def _withdrawn_products(
    items: Sequence[MenuItem],
    live: dict[uuid.UUID, list[tuple[uuid.UUID, float, Product]]],
) -> list[WithdrawnProduct]:
    """Продукты дня, выведенные из оборота."""

    by_item = _product_ids_by_item(items, live)

    known: dict[uuid.UUID, Product] = {
        pid: product for rows in live.values() for pid, _, product in rows
    }
    withdrawn = {pid: product for pid, product in known.items() if not product.is_active}
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


async def build_snapshots(
    session: AsyncSession, *, patient_id: uuid.UUID, items: Sequence[MenuItemWrite]
) -> list[dict[str, Any]]:
    """Снимок каждой позиции: всё, что нужно для повторного расчёта без
    обращения к текущим рецептам и продуктам.

    Позиция ссылается на рецепт или своё блюдо, а те живут своей жизнью:
    диетолог правит рецепт, администратор — числа продукта. Пока снимка не
    было, правка задним числом меняла прошлые дни при первом же их сохранении,
    и ответить, чем ребёнок питался первого мая, было нельзя.

    Поэтому в снимок идут и значения продуктов на 100 г: без них пересчёт
    опирался бы на сегодняшние числа, то есть ровно на то, что мы замораживаем.
    Название продукта — тоже: продукт могут переименовать, а прочитать состав
    прошлого дня надо и через год.

    Здесь же происходит проверка плана: рецепт опубликован, своё блюдо
    принадлежит пациенту, продукты существуют. Отказ на этом шаге означает, что
    день не сохранится вовсе, — частично сохранённый день хуже отказа.
    """

    compositions, recipes = await _compositions(session, patient_id=patient_id, items=items)
    products = await _products(session, compositions=compositions)
    dishes = await _custom_dishes(session, patient_id=patient_id, items=items)

    snapshots: list[dict[str, Any]] = []
    for item, composition in zip(items, compositions, strict=True):
        ingredients = [
            {
                "product_id": str(product_id),
                "name_ru": products[product_id].name_ru,
                "grams": grams,
                "kcal_100g": float(products[product_id].kcal_100g),
                "fat_100g": float(products[product_id].fat_100g),
                "protein_100g": float(products[product_id].protein_100g),
                "carbs_100g": float(products[product_id].carbs_100g),
                "fiber_100g": float(products[product_id].fiber_100g),
            }
            for product_id, grams in composition
        ]
        dish = verify(
            [
                (composition_service.to_ingredient(products[pid]), grams)
                for pid, grams in composition
            ]
        )
        title = (
            recipes[item.recipe_id].title
            if item.recipe_id is not None
            else dishes[item.custom_dish_id].title
            if item.custom_dish_id is not None
            # Схема MenuItemWrite это исключает; ветка оставлена, чтобы её
            # ослабление не превратилось в снимок без названия.
            else ""
        )

        snapshots.append(
            {
                "title": title,
                "servings": _servings(item, recipes),
                "ingredients": ingredients,
                "totals": composition_service.totals_of(dish),
                "engine_version": ENGINE_VERSION,
            }
        )
    return snapshots


def totals_from_items(items: Sequence[MenuItem]) -> tuple[dict[str, Any], str]:
    """Итоги дня по снимкам сохранённых позиций.

    Складывать показатели блюд руками нельзя — соотношение не аддитивно, —
    поэтому масштабированные составы всех позиций уходят в `verify()` разом,
    как и раньше. Изменилось одно: числа берутся из снимка, а не из текущих
    строк, и день не меняется от того, что кто-то поправил рецепт.
    """

    scaled: list[tuple[Ingredient, float]] = []
    for item in items:
        snapshot = item.snapshot
        if snapshot is None:
            continue
        dish = verify(
            [(_snapshot_ingredient(row), float(row["grams"])) for row in snapshot["ingredients"]]
        )
        portion = scale(dish, float(item.portion_factor) / int(snapshot["servings"]))
        scaled.extend((amount.ingredient, amount.grams) for amount in portion.items)

    return composition_service.totals_of(verify(scaled)), ENGINE_VERSION


def _snapshot_ingredient(row: dict[str, Any]) -> Ingredient:
    return Ingredient(
        product_id=str(row["product_id"]),
        kcal=float(row["kcal_100g"]),
        fat=float(row["fat_100g"]),
        protein=float(row["protein_100g"]),
        carbs=float(row["carbs_100g"]),
        fiber=float(row["fiber_100g"]),
    )


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
