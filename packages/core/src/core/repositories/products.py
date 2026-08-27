"""Репозиторий продуктов. Любое изменение пишет ревизию (раздел 4.2 ТЗ:
`product_revisions` — "пишется триггером/репозиторием при каждом изменении products")."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import ColumnElement, func, select
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


async def search(
    session: AsyncSession,
    *,
    q: str | None = None,
    category_id: uuid.UUID | None = None,
    only_active: bool = True,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Product], int]:
    """Поиск продуктов. `q` — полнотекст по name_ru (GIN-индекс `ix_products_name_ru_fts`)."""

    conditions: list[ColumnElement[bool]] = []
    if only_active:
        conditions.append(Product.is_active.is_(True))
    if category_id is not None:
        conditions.append(Product.category_id == category_id)
    if q:
        conditions.append(
            func.to_tsvector("russian", Product.name_ru).op("@@")(
                func.plainto_tsquery("russian", q)
            )
        )

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


async def get_or_create_category(session: AsyncSession, *, name_ru: str) -> ProductCategory:
    """Категория из CSV задаётся именем: справочник небольшой и ведётся админом."""

    existing = await session.scalar(
        select(ProductCategory).where(ProductCategory.name_ru == name_ru)
    )
    if existing is not None:
        return existing

    category = ProductCategory(name_ru=name_ru, sort=0)
    session.add(category)
    await session.flush()
    return category
