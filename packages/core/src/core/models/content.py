"""Контент: продукты, рецепты, кастомные блюда (раздел 4.2 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, SoftDeleteMixin, UpdatedAtMixin, UUIDPkMixin
from .enums import (
    CarbsConvention,
    FoodDietType,
    FoodStandardKind,
    RecipeCategory,
    RecipeStatus,
    pg_enum,
)

#: Стандарт, в который миграция сложила весь прежний справочник (ADR-0056).
#: Постоянный идентификатор: на него опираются умолчания схемы и поиск, а
#: искать «главный» стандарт по названию значило бы зависеть от его написания.
DEFAULT_FOOD_STANDARD_ID = uuid.UUID("00000000-0000-7000-8000-000000000001")


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


class FoodStandard(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    """Набор значений продуктов, по которому специалист собирает меню (ADR-0056).

    Закрыт стандарт, у которого стоит `locked_at`: его значения не правит никто.
    Вид и закрытость разделены, потому что внешний документ сначала загружается,
    и только потом закрывается.
    """

    __tablename__ = "food_standards"
    __table_args__ = (
        Index(
            "uq_food_standards_name_normalized",
            text("lower(btrim(name))"),
            unique=True,
        ),
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    publisher: Mapped[str | None] = mapped_column(String(255))
    document: Mapped[str | None] = mapped_column(String(255))
    version: Mapped[str | None] = mapped_column(String(64))
    effective_on: Mapped[date | None] = mapped_column(Date)
    kind: Mapped[FoodStandardKind] = mapped_column(
        pg_enum(FoodStandardKind, "food_standard_kind"), nullable=False
    )
    diet_type: Mapped[FoodDietType] = mapped_column(
        pg_enum(FoodDietType, "food_diet_type"), nullable=False
    )
    carbs_convention: Mapped[CarbsConvention] = mapped_column(
        pg_enum(CarbsConvention, "carbs_convention"), nullable=False
    )
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )


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
        # Внутри стандарта: в разных стандартах у одного названия свои значения.
        Index(
            "uq_products_standard_name_normalized",
            text("standard_id"),
            text("lower(btrim(name_ru))"),
            unique=True,
        ),
        Index("ix_products_food_id", "food_id"),
    )

    standard_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("food_standards.id"),
        nullable=False,
        default=DEFAULT_FOOD_STANDARD_ID,
        server_default=text(f"'{DEFAULT_FOOD_STANDARD_ID}'::uuid"),
    )
    #: Что это за продукт, независимо от стандарта: одно и то же молоко в разных
    #: стандартах носит один `food_id`, и исключение ребёнка действует на все
    #: его записи. Общий идентификатор, а не ссылка на таблицу (ADR-0056).
    food_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        default=uuid.uuid4,
        server_default=text("gen_random_uuid()"),
    )
    #: Запись, с которой снята эта копия при корректировке закрытого стандарта.
    derived_from_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("products.id")
    )
    #: Происхождение отдельных чисел: ключ — поле значения (`kcal_100g` …),
    #: значение — `{"kind": "product", "product_id"}` (взято из записи стандарта)
    #: или `{"kind": "manual", "user_id", "at"}` (вписано человеком). Нет ключа —
    #: число подписано источником всей строки (`source`/`source_version`).
    value_sources: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    #: `false` — источник клетчатку не указал и `fiber_100g` = 0 значит «неизвестно».
    fiber_known: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
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
    #: Участвует ли продукт в расчёте (ADR-0054, ответ клиники на вопрос 16).
    #:
    #: Соль, перец и подобные приправы стоят в составе ради рецепта и списка
    #: «что взвесить», но в соотношение, калорийность и лимит углеводов не
    #: входят. По умолчанию — участвует: какие продукты считать приправами,
    #: решает диетолог отметкой в карточке, а не миграция.
    counts_in_calculation: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )


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
    standard_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("food_standards.id"),
        nullable=False,
        index=True,
        default=DEFAULT_FOOD_STANDARD_ID,
        server_default=text(f"'{DEFAULT_FOOD_STANDARD_ID}'::uuid"),
    )
    #: Where the dish came from in an external document, for example a page.
    source_ref: Mapped[str | None] = mapped_column(String(255))


class MenuTemplate(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    """A multi-day menu published in a food standard (ADR-0060)."""

    __tablename__ = "menu_templates"

    standard_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("food_standards.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    season: Mapped[str | None] = mapped_column(String(64))
    cycle_days: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[RecipeStatus] = mapped_column(
        pg_enum(RecipeStatus, "recipe_status"), nullable=False, default=RecipeStatus.DRAFT
    )
    source_ref: Mapped[str | None] = mapped_column(String(255))


class MenuTemplateItem(Base, UUIDPkMixin, CreatedAtMixin):
    __tablename__ = "menu_template_items"

    template_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("menu_templates.id"), nullable=False, index=True
    )
    cycle_day: Mapped[int] = mapped_column(Integer, nullable=False)
    meal_index: Mapped[int] = mapped_column(Integer, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: The dish name as the document gives it, also when there is no recipe.
    dish_title: Mapped[str] = mapped_column(String(255), nullable=False)
    #: `NULL`: the dish uses products without reliable values, so it has no numbers.
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("recipes.id")
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
