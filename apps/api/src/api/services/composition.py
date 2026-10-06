"""Состав блюда: продукты из базы → типы расчётного ядра.

Единственное место, где строки `products` превращаются в `keto_engine.Ingredient`
и где результат ядра раскладывается в `computed`. Раньше это существовало в трёх
почти дословных копиях (свои блюда, рецепты, меню) — расхождение любой из них
означало бы, что одинаковый состав считается по-разному в разных разделах.

Продукты всегда берутся из базы по идентификаторам, а не из тела запроса: иначе
клиент прислал бы произвольные макронутриенты и получил «правильный» расчёт по
выдуманным данным — а по нему кормят ребёнка.

Здесь же состав делится на учитываемое и приправы (`split`, ADR-0054): приправа
остаётся в составе, но на вход ядра не идёт. Делит одна функция на все пути —
рецепт, своё блюдо, снимок дня, калькулятор, — иначе путь, забывший про
отметку, считал бы соль в соотношение, а соседний нет.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Product
from core.repositories import products as products_repo
from keto_engine import ENGINE_VERSION, DishResult, Ingredient, verify

from ..errors import ApiError, ErrorCode

#: Состав как пары «продукт — масса в граммах».
Composition = Sequence[tuple[uuid.UUID, float]]


def to_ingredient(product: Product) -> Ingredient:
    """Строка `products` → вход расчётного ядра (значения на 100 г)."""

    return Ingredient(
        product_id=str(product.id),
        kcal=float(product.kcal_100g),
        fat=float(product.fat_100g),
        protein=float(product.protein_100g),
        carbs=float(product.carbs_100g),
        fiber=float(product.fiber_100g),
    )


@dataclass(frozen=True, slots=True)
class UncountedItem:
    """Позиция состава, которая в расчёт не входит: приправа и её масса."""

    product_id: uuid.UUID
    name_ru: str
    grams: float


def counts_in_calculation(product: Product) -> bool:
    """Входит ли продукт в расчёт (ADR-0054).

    `None` — у объекта, собранного в памяти до записи в базу, умолчание
    колонки ещё не применено, — читается как «входит»: так же решает база.
    """

    return product.counts_in_calculation is not False


def snapshot_row_counts(row: Mapping[str, Any]) -> bool:
    """То же для строки снимка позиции меню.

    Снимки, сохранённые до отметки, ключа не несут и читаются как
    «входит» — ровно так их и считали, когда сохраняли.
    """

    return row.get("counts_in_calculation", True) is not False


def split(
    rows: Iterable[tuple[Product, float]],
) -> tuple[list[tuple[Ingredient, float]], list[UncountedItem]]:
    """Состав → (вход ядра, приправы).

    Единственное место, где решается, что из состава уходит в расчёт. Приправа
    не превращается в `Ingredient` вовсе: ядро её не видит, и ни соотношение,
    ни калорийность, ни лимит углеводов от неё не зависят. Порядок позиций в
    обоих списках — порядок состава.
    """

    counted: list[tuple[Ingredient, float]] = []
    uncounted: list[UncountedItem] = []
    for product, grams in rows:
        if counts_in_calculation(product):
            counted.append((to_ingredient(product), grams))
        else:
            uncounted.append(
                UncountedItem(product_id=product.id, name_ru=product.name_ru, grams=grams)
            )
    return counted, uncounted


async def uncounted_products(
    session: AsyncSession, *, product_ids: Iterable[str]
) -> dict[str, Product]:
    """Какие из идентификаторов `/calc` — приправы, по справочнику.

    `/calc` получает значения продуктов в теле запроса, но отметку берёт из
    базы: клиент, не знающий о ней или забывший её передать, иначе считал бы
    соль в соотношение. Идентификатор не из справочника приправой быть не
    может — такой продукт считается, как и раньше.
    """

    parsed: dict[uuid.UUID, str] = {}
    for raw in product_ids:
        try:
            parsed[uuid.UUID(raw)] = raw
        except ValueError:
            continue

    products = await products_repo.get_by_ids(session, product_ids=list(parsed))
    return {
        parsed[pid]: product
        for pid, product in products.items()
        if not counts_in_calculation(product)
    }


def totals_of(dish: DishResult) -> dict[str, Any]:
    """Показатели блюда в форме, которая хранится в `computed`/`totals` (раздел 4.2 ТЗ)."""

    return {
        "kcal": dish.kcal,
        "fat": dish.fat_g,
        "protein": dish.protein_g,
        "carbs": dish.carbs_g,
        "fiber": dish.fiber_g,
        "ratio": dish.ratio,
    }


async def load_products(
    session: AsyncSession,
    *,
    product_ids: Sequence[uuid.UUID],
    missing_message: str = "В составе указаны продукты, которых нет в базе.",
) -> dict[uuid.UUID, Product]:
    """Продукты по идентификаторам; отсутствующие — 422 с их перечнем."""

    products = await products_repo.get_by_ids(session, product_ids=product_ids)

    missing = sorted({str(pid) for pid in product_ids if pid not in products})
    if missing:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR, missing_message, details={"product_ids": missing}
        )
    return products


async def load_items(
    session: AsyncSession, *, composition: Composition
) -> tuple[list[tuple[Ingredient, float]], list[UncountedItem]]:
    """Состав → (вход `verify()`/`scale()`, приправы вне расчёта)."""

    products = await load_products(
        session, product_ids=[product_id for product_id, _ in composition]
    )
    return split((products[product_id], grams) for product_id, grams in composition)


async def compute(session: AsyncSession, *, composition: Composition) -> tuple[dict[str, Any], str]:
    """Показатели непустого состава и версия ядра, которой они получены.

    Версия сохраняется рядом со значениями (раздел 4.1 ТЗ): без неё нельзя
    сказать, каким кодом посчитан сохранённый результат.
    """

    items, uncounted = await load_items(session, composition=composition)
    computed = totals_of(verify(items))
    # Какие позиции в эти числа не вошли — рядом с самими числами (ADR-0054).
    # Карточка рецепта показывает пометку «приправа» по этому списку, а не по
    # живой отметке продукта: сохранённый расчёт задним числом не
    # пересчитывается, и пометка по живой отметке утверждала бы о числах то,
    # чего в них нет.
    computed["uncounted_product_ids"] = [str(item.product_id) for item in uncounted]
    return computed, ENGINE_VERSION


async def compute_optional(
    session: AsyncSession, *, composition: Composition
) -> tuple[dict[str, Any] | None, str | None]:
    """То же, но пустой состав допустим: у черновика без ингредиентов считать нечего."""

    if not composition:
        return None, None
    return await compute(session, composition=composition)


def duplicate_product_ids(product_ids: Iterable[uuid.UUID]) -> list[uuid.UUID]:
    """Продукты, встречающиеся в составе больше одного раза.

    Один продукт дважды — почти наверняка ошибка ввода, а массы при этом молча
    сложились бы и расчёт выглядел бы правдоподобным.
    """

    seen: set[uuid.UUID] = set()
    duplicates: list[uuid.UUID] = []
    for product_id in product_ids:
        if product_id in seen:
            duplicates.append(product_id)
        seen.add(product_id)
    return duplicates


def stored_composition(composition: Composition) -> list[dict[str, Any]]:
    """Состав в форме, в которой он лежит в jsonb (раздел 4.2 ТЗ: `[{product_id, grams}]`)."""

    return [{"product_id": str(product_id), "grams": grams} for product_id, grams in composition]
