"""Контент: продукты, рецепты, кастомные блюда (раздел 4.2 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, SoftDeleteMixin, UpdatedAtMixin, UUIDPkMixin
from .enums import RecipeCategory, RecipeStatus, pg_enum


class ProductCategory(Base, UUIDPkMixin):
    __tablename__ = "product_categories"
    __table_args__ = (
        # Категория рождалась побочным эффектом импорта, а сверка имени шла
        # точным совпадением: файл с колонкой «жиры» заводил вторую категорию
        # рядом с «Жиры». Разъехавшийся справочник означает, что часть
        # продуктов не находится по фильтру, а заметить это можно было только
        # глазами в выпадающем списке.
        #
        # Функциональный индекс, как у названия продукта: name_ru — String,
        # а не CITEXT.
        Index(
            "uq_product_categories_name_ru_normalized",
            text("lower(btrim(name_ru))"),
            unique=True,
        ),
    )

    name_ru: Mapped[str] = mapped_column(String(255), nullable=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Product(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "products"
    __table_args__ = (
        Index(
            "ix_products_name_ru_fts",
            text("to_tsvector('russian', name_ru)"),
            postgresql_using="gin",
        ),
        # Уникальность по нормализованному названию. Приложение и так отклоняет дубли
        # при импорте, но проверка «прочитать, затем вставить» не защищает от двух
        # одновременных импортов — а две записи с одним названием и разными
        # значениями означают риск выбрать «не тот» продукт при расчёте меню.
        # Функциональный индекс, потому что name_ru — String, а не CITEXT.
        Index(
            "uq_products_name_ru_normalized",
            text("lower(btrim(name_ru))"),
            unique=True,
        ),
    )

    name_ru: Mapped[str] = mapped_column(String(255), nullable=False)
    name_uz: Mapped[str | None] = mapped_column(String(255))
    name_en: Mapped[str | None] = mapped_column(String(255))
    category_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("product_categories.id"), nullable=False
    )
    kcal_100g: Mapped[float] = mapped_column(Numeric(7, 2), nullable=False)
    fat_100g: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    protein_100g: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    carbs_100g: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    fiber_100g: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    source: Mapped[str] = mapped_column(String(255), nullable=False)
    source_version: Mapped[str] = mapped_column(String(64), nullable=False)
    verified_at: Mapped[date] = mapped_column(Date, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ProductRevision(Base, UUIDPkMixin):
    """Пишется репозиторием при каждом изменении `products` (раздел 4.2 ТЗ)."""

    __tablename__ = "product_revisions"

    product_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("products.id"), nullable=False
    )
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    changed_by: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    changed_at: Mapped[datetime]


class Recipe(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "recipes"
    __table_args__ = (
        Index(
            "ix_recipes_title_fts",
            text("to_tsvector('russian', title)"),
            postgresql_using="gin",
        ),
    )

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[RecipeCategory] = mapped_column(
        pg_enum(RecipeCategory, "recipe_category"), nullable=False
    )
    photo_path: Mapped[str | None] = mapped_column(String(512))
    yield_g: Mapped[float] = mapped_column(Numeric(7, 1), nullable=False)
    servings: Mapped[int] = mapped_column(Integer, nullable=False)
    instructions: Mapped[str] = mapped_column(nullable=False)
    status: Mapped[RecipeStatus] = mapped_column(
        pg_enum(RecipeStatus, "recipe_status"), nullable=False, default=RecipeStatus.DRAFT
    )
    computed: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB
    )  # {kcal, fat, protein, carbs, ratio}
    engine_version: Mapped[str | None] = mapped_column(String(32))
    author_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )


class RecipeIngredient(Base, UUIDPkMixin, CreatedAtMixin):
    __tablename__ = "recipe_ingredients"

    recipe_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("recipes.id"), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("products.id"), nullable=False
    )
    grams: Mapped[float] = mapped_column(Numeric(7, 1), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class CustomDish(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin, SoftDeleteMixin):
    __tablename__ = "custom_dishes"

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    ingredients: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False
    )  # [{product_id, grams}]
    computed: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    engine_version: Mapped[str | None] = mapped_column(String(32))
