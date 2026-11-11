"""recipe categories salad and smoothie

Разделы «Салаты» и «Смузи» — просьба диетолога клиники от 21.10.2026: одна
общая база рецептов по разделам «завтраки, основные блюда, салаты, перекусы,
смузи, десерты, выпечка». Остальные разделы уже были.

Автогенерация состав перечислений не сравнивает, поэтому `ALTER TYPE`
рукописный, как в ревизии f739fbebd238.

Revision ID: aa3e97d5177d
Revises: 7966f2013300
Create Date: 2026-11-11

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "aa3e97d5177d"
down_revision: str | None = "7966f2013300"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VALUES_BEFORE = (
    "breakfast",
    "lunch",
    "dinner",
    "snack",
    "dessert",
    "drink",
    "bakery",
    "bread",
)


def upgrade() -> None:
    op.execute(sa.text("ALTER TYPE recipe_category ADD VALUE IF NOT EXISTS 'salad' AFTER 'dinner'"))
    op.execute(
        sa.text("ALTER TYPE recipe_category ADD VALUE IF NOT EXISTS 'smoothie' AFTER 'drink'")
    )


def downgrade() -> None:
    bind = op.get_bind()
    used = bind.scalar(
        sa.text("SELECT count(*) FROM recipes WHERE category::text IN ('salad', 'smoothie')")
    )
    if used:
        raise RuntimeError(
            f"Откат невозможен: {used} рецептов отнесены к салатам или смузи. "
            "Сначала переставьте им другую категорию."
        )

    values = ", ".join(f"'{value}'" for value in _VALUES_BEFORE)
    op.execute(sa.text(f"CREATE TYPE recipe_category_old AS ENUM ({values})"))
    op.execute(
        sa.text(
            "ALTER TABLE recipes ALTER COLUMN category "
            "TYPE recipe_category_old USING category::text::recipe_category_old"
        )
    )
    op.execute(sa.text("DROP TYPE recipe_category"))
    op.execute(sa.text("ALTER TYPE recipe_category_old RENAME TO recipe_category"))
