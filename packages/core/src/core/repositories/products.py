"""Репозиторий продуктов. Любое изменение пишет ревизию (раздел 4.2 ТЗ:
`product_revisions` — "пишется триггером/репозиторием при каждом изменении products")."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy import update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Product, ProductCategory, ProductRevision

_SNAPSHOT_FIELDS = (
    "name_ru",
    "name_uz",
    "name_en",
    "category_id",
    "kcal_100g",
    "fat_100g",
    "protein_100g",
    "carbs_100g",
    "fiber_100g",
    "source",
    "source_version",
    "verified_at",
    "is_active",
)


def _snapshot(product: Product) -> dict[str, Any]:
    """Значения продукта для `product_revisions.snapshot` (json-сериализуемые)."""

    result: dict[str, Any] = {}
    for field in _SNAPSHOT_FIELDS:
        value = getattr(product, field)
        if isinstance(value, uuid.UUID):
            value = str(value)
        elif isinstance(value, date | datetime):
            value = value.isoformat()
        elif value is not None and not isinstance(value, str | int | float | bool):
            value = float(value)  # Numeric -> Decimal
        result[field] = value
    return result


async def get(session: AsyncSession, product_id: uuid.UUID) -> Product | None:
    return await session.get(Product, product_id)


def _like_pattern(q: str) -> str:
    """`%` и `_` во вводе — это подстановочные знаки LIKE, а не буквы.

    Без экранирования запрос «100%» превращался бы в «что угодно», а «_» — в
    «любой символ»: поиск молча возвращал бы не то, что попросили.
    """

    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _name_matches(q: str) -> ColumnElement[bool]:
    """Совпадение по названию: словоформы ИЛИ подстрока, по обоим языкам.

    `name_uz` включён потому, что это второе имя, которое видит человек. Пока
    узбекские названия не заполнены, условие просто не срабатывает; когда
    медицинская команда их пришлёт, поиск начнёт работать без правок кода.
    `name_en` намеренно не ищется: это поле происхождения (описание позиции в
    источнике), а не название для показа.
    """

    pattern = _like_pattern(q)
    query = func.websearch_to_tsquery("russian", q)
    return or_(
        Product.name_ru.ilike(pattern, escape="\\"),
        Product.name_uz.ilike(pattern, escape="\\"),
        func.to_tsvector("russian", Product.name_ru).op("@@")(query),
    )


async def search(
    session: AsyncSession,
    *,
    q: str | None = None,
    category_id: uuid.UUID | None = None,
    only_active: bool = True,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Product], int]:
    """Поиск продуктов по названию — по мере ввода, а не по готовому слову.

    Условие сдвоенное, и обе половины нужны.

    **Полнотекст** (GIN-индекс `ix_products_name_ru_fts`) даёт словоформы и
    независимость от порядка слов: «маслом» находит «Масло», «сливочное масло»
    находит «Масло сливочное». Но ищет он ЦЕЛЫМИ лексемами — «мас» не находило
    ничего, и поиск оживал только на полностью набранном слове.

    **Подстрока** покрывает то, что полнотекст не умеет в принципе: совпадение с
    середины слова. «ливоч» находит «сливочное» — а никакой префиксный поиск,
    включая `to_tsquery('мас:*')`, этого не сделает.

    Используется `websearch_to_tsquery`, а не `to_tsquery`: последний падает на
    произвольном вводе (`&`, `|`, `!`, `:` — синтаксис запроса), и строка поиска
    из формы роняла бы запрос. `websearch_to_tsquery` принимает что угодно.
    """

    conditions: list[ColumnElement[bool]] = []
    if only_active:
        conditions.append(Product.is_active.is_(True))
    if category_id is not None:
        conditions.append(Product.category_id == category_id)
    if q:
        conditions.append(_name_matches(q))

    stmt = select(Product).where(*conditions).order_by(Product.name_ru).limit(limit).offset(offset)
    items = list(await session.scalars(stmt))

    total = await session.scalar(select(func.count()).select_from(Product).where(*conditions))
    return items, int(total or 0)


async def create(session: AsyncSession, *, changed_by: uuid.UUID, **fields: Any) -> Product:
    product = Product(**fields)
    session.add(product)
    await session.flush()
    await _write_revision(session, product=product, changed_by=changed_by)
    return product


async def update(
    session: AsyncSession, *, product: Product, changed_by: uuid.UUID, **fields: Any
) -> Product:
    """Обновляет продукт и пишет ревизию с новым состоянием."""

    for key, value in fields.items():
        setattr(product, key, value)
    await session.flush()
    await _write_revision(session, product=product, changed_by=changed_by)
    return product


async def _write_revision(
    session: AsyncSession, *, product: Product, changed_by: uuid.UUID
) -> ProductRevision:
    revision = ProductRevision(
        product_id=product.id,
        snapshot=_snapshot(product),
        changed_by=changed_by,
        changed_at=datetime.now(UTC),
    )
    session.add(revision)
    await session.flush()
    return revision


async def list_revisions(session: AsyncSession, *, product_id: uuid.UUID) -> list[ProductRevision]:
    stmt = (
        select(ProductRevision)
        .where(ProductRevision.product_id == product_id)
        .order_by(ProductRevision.changed_at.desc())
    )
    return list(await session.scalars(stmt))


async def list_categories(session: AsyncSession) -> list[ProductCategory]:
    """Порядок — по `sort`, затем по названию: `sort` задаёт администратор и
    дубликаты в нём допустимы, а порядок в справочнике должен быть устойчивым."""

    stmt = select(ProductCategory).order_by(ProductCategory.sort, ProductCategory.name_ru)
    return list(await session.scalars(stmt))


async def count_products_by_category(session: AsyncSession) -> dict[uuid.UUID, int]:
    """Сколько позиций в каждой категории — одним запросом на весь список.

    Запрос на категорию в цикле дал бы столько же ответов и вдесятеро больше
    обращений к базе на экране, который открывают ради одного взгляда.
    """

    rows = await session.execute(
        select(Product.category_id, func.count()).group_by(Product.category_id)
    )
    return {row[0]: int(row[1]) for row in rows}


async def get_category(session: AsyncSession, category_id: uuid.UUID) -> ProductCategory | None:
    return await session.get(ProductCategory, category_id)


async def find_category_by_name(
    session: AsyncSession, *, name_ru: str, exclude_id: uuid.UUID | None = None
) -> ProductCategory | None:
    """Категория с таким именем — без учёта регистра и внешних пробелов.

    Сверка шла точным совпадением, поэтому «Жиры» и «жиры» заводились как две
    разные категории. Заметить это можно было только глазами в выпадающем
    списке, а разъехавшийся справочник означает, что часть продуктов не
    находится по фильтру.
    """

    conditions = [func.lower(func.trim(ProductCategory.name_ru)) == name_ru.casefold().strip()]
    if exclude_id is not None:
        conditions.append(ProductCategory.id != exclude_id)
    found: ProductCategory | None = await session.scalar(select(ProductCategory).where(*conditions))
    return found


async def create_category(session: AsyncSession, *, name_ru: str, sort: int = 0) -> ProductCategory:
    category = ProductCategory(name_ru=name_ru, sort=sort)
    session.add(category)
    await session.flush()
    return category


async def update_category(
    session: AsyncSession, *, category: ProductCategory, **fields: Any
) -> ProductCategory:
    for key, value in fields.items():
        setattr(category, key, value)
    await session.flush()
    return category


async def count_products_in_category(session: AsyncSession, *, category_id: uuid.UUID) -> int:
    """Сколько позиций в категории — включая выведенные из оборота.

    Выведенная позиция остаётся в рецептах и меню, где уже стоит, и удалять
    вместе с категорией её нельзя.
    """

    total = await session.scalar(
        select(func.count()).select_from(Product).where(Product.category_id == category_id)
    )
    return int(total or 0)


async def merge_categories(
    session: AsyncSession, *, source: ProductCategory, target: ProductCategory
) -> int:
    """Переносит продукты в другую категорию и удаляет опустевшую.

    Слияние — единственный способ свести разъехавшийся справочник: удалить
    непустую категорию нельзя (продукты остались бы без неё), а переносить
    позиции по одной вручную — работа на день.

    Возвращает число перенесённых позиций: оно попадает в журнал аудита, и по
    нему видно масштаб операции.
    """

    result = await session.execute(
        sql_update(Product).where(Product.category_id == source.id).values(category_id=target.id)
    )
    await session.delete(source)
    await session.flush()
    return int(result.rowcount or 0)  # type: ignore[attr-defined]


async def get_or_create_category(session: AsyncSession, *, name_ru: str) -> ProductCategory:
    """Категория из CSV задаётся именем: справочник небольшой и ведётся админом.

    Сверка без учёта регистра и внешних пробелов: файл с колонкой «жиры» не
    должен заводить вторую категорию рядом с «Жиры».
    """

    existing = await find_category_by_name(session, name_ru=name_ru)
    if existing is not None:
        return existing

    return await create_category(session, name_ru=name_ru)


async def get_by_names(session: AsyncSession, *, names: list[str]) -> dict[str, Product]:
    """Продукты по нормализованным именам — для обновляющего импорта.

    Ключ словаря — имя, приведённое так же, как в уникальном индексе: файл
    новой версии базы состава приходит с другим написанием («Масло сливочное»
    и «масло сливочное»), а это одна и та же позиция.
    """

    if not names:
        return {}

    folded = {name.casefold().strip() for name in names}
    rows = await session.scalars(
        select(Product).where(func.lower(func.trim(Product.name_ru)).in_(folded))
    )
    return {product.name_ru.casefold().strip(): product for product in rows}


async def find_duplicate_names(session: AsyncSession, *, names: list[str]) -> set[str]:
    """Какие из имён уже есть в базе продуктов.

    База продуктов — вход для расчёта диеты: два продукта с одинаковым названием и
    разными значениями создают риск выбрать «не тот» при составлении меню, поэтому
    импорт сообщает о совпадениях, а не молча плодит дубли.
    """

    if not names:
        return set()

    # Сравнение регистронезависимое: name_ru — обычный String, не CITEXT, поэтому
    # «Масло» и «масло» иначе считались бы разными продуктами.
    folded = [name.casefold().strip() for name in names]
    rows = await session.scalars(
        select(Product.name_ru).where(func.lower(func.trim(Product.name_ru)).in_(folded))
    )
    return {name.casefold().strip() for name in rows}


async def get_by_ids(
    session: AsyncSession, *, product_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, Product]:
    """Продукты по идентификаторам — для пересчёта состава блюд, рецептов и меню.

    Отсутствующие идентификаторы просто не попадают в результат: решает,
    что с ними делать, вызывающая сторона (обычно это 422 с перечнем).
    """

    if not product_ids:
        return {}

    rows = await session.scalars(select(Product).where(Product.id.in_(list(product_ids))))
    return {product.id: product for product in rows}
