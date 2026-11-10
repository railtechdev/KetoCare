"""food standards

Стандарт питания становится сущностью, продукт принадлежит стандарту (ADR-0056).

Весь прежний справочник уходит в один открытый стандарт клиники с постоянным
идентификатором. Закрывать его нельзя: корректировки копией в интерфейсе ещё
нет, и диетолог потерял бы возможность править продукты. Значения продуктов,
рецепты, снимки дней и исключения детей ревизия не трогает.

У каждой строки свой `food_id`, потому что до ревизии названия были уникальны.
Клетчатка считается известной: у прежних продуктов она заполнена.

Откат отказывает, если появились продукты других стандартов: при возврате к
общей уникальности названий их значения потерялись бы.

Revision ID: b7f4c2a91e30
Revises: 835a8cbd4206
Create Date: 2026-11-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b7f4c2a91e30"
down_revision: str | None = "835a8cbd4206"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEFAULT_STANDARD_ID = "00000000-0000-7000-8000-000000000001"


def upgrade() -> None:
    kind = postgresql.ENUM("reference", "clinic", name="food_standard_kind", create_type=False)
    diet = postgresql.ENUM("ketogenic", "general", name="food_diet_type", create_type=False)
    carbs = postgresql.ENUM("total", "net", "unknown", name="carbs_convention", create_type=False)
    for enum_type in (kind, diet, carbs):
        enum_type.create(op.get_bind(), checkfirst=False)

    op.create_table(
        "food_standards",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("publisher", sa.String(length=255), nullable=True),
        sa.Column("document", sa.String(length=255), nullable=True),
        sa.Column("version", sa.String(length=64), nullable=True),
        sa.Column("effective_on", sa.Date(), nullable=True),
        sa.Column("kind", kind, nullable=False),
        sa.Column("diet_type", diet, nullable=False),
        sa.Column("carbs_convention", carbs, nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_food_standards_name_normalized",
        "food_standards",
        [sa.text("lower(btrim(name))")],
        unique=True,
    )
    op.execute(
        f"""
        INSERT INTO food_standards (id, name, kind, diet_type, carbs_convention)
        VALUES ('{_DEFAULT_STANDARD_ID}', 'Справочник клиники', 'clinic', 'ketogenic', 'total')
        """
    )

    op.add_column(
        "products",
        sa.Column(
            "standard_id",
            sa.UUID(),
            server_default=sa.text(f"'{_DEFAULT_STANDARD_ID}'::uuid"),
            nullable=False,
        ),
    )
    op.add_column(
        "products",
        sa.Column(
            "food_id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
    )
    op.add_column("products", sa.Column("derived_from_id", sa.UUID(), nullable=True))
    op.add_column(
        "products",
        sa.Column("fiber_known", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.create_foreign_key(
        "products_standard_id_fkey", "products", "food_standards", ["standard_id"], ["id"]
    )
    op.create_foreign_key(
        "products_derived_from_id_fkey", "products", "products", ["derived_from_id"], ["id"]
    )
    op.create_index("ix_products_food_id", "products", ["food_id"])
    op.drop_index("uq_products_name_ru_normalized", table_name="products")
    op.create_index(
        "uq_products_standard_name_normalized",
        "products",
        [sa.text("standard_id"), sa.text("lower(btrim(name_ru))")],
        unique=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    foreign = bind.scalar(
        sa.text(f"SELECT count(*) FROM products WHERE standard_id <> '{_DEFAULT_STANDARD_ID}'")
    )
    if foreign:
        raise RuntimeError(
            f"Откат невозможен: {foreign} продуктов принадлежат другим стандартам. "
            "Сначала перенесите или выведите их."
        )

    op.drop_index("uq_products_standard_name_normalized", table_name="products")
    op.create_index(
        "uq_products_name_ru_normalized",
        "products",
        [sa.text("lower(btrim(name_ru))")],
        unique=True,
    )
    op.drop_index("ix_products_food_id", table_name="products")
    op.drop_constraint("products_derived_from_id_fkey", "products", type_="foreignkey")
    op.drop_constraint("products_standard_id_fkey", "products", type_="foreignkey")
    op.drop_column("products", "fiber_known")
    op.drop_column("products", "derived_from_id")
    op.drop_column("products", "food_id")
    op.drop_column("products", "standard_id")
    op.drop_index("uq_food_standards_name_normalized", table_name="food_standards")
    op.drop_table("food_standards")
    for name in ("carbs_convention", "food_diet_type", "food_standard_kind"):
        postgresql.ENUM(name=name).drop(bind, checkfirst=False)
