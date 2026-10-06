"""recipe categories bakery and bread

Категории рецептов «Выпечка» и «Хлеб» — ответ клиники от 09.09.2026 на
вопрос 28: «Можно сделать разделы: завтрак, обед, ужин, перекус (снэки),
десерты, напитки (коктейли, смузи), выпечка, хлеб — и в каждый из этих
разделов заложить рецепты». Шесть разделов из восьми уже были; двух не
хватало.

**Автогенерация этого не видит** (состав перечислений Alembic не сравнивает),
поэтому `ALTER TYPE` рукописный — как в ревизии 82861bb2d318.

Revision ID: f739fbebd238
Revises: 801c8afc64d3
Create Date: 2026-10-06

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f739fbebd238"
down_revision: str | None = "801c8afc64d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VALUES_BEFORE = ("breakfast", "lunch", "dinner", "snack", "dessert", "drink")
_NEW_VALUES = ("bakery", "bread")


def upgrade() -> None:
    # Порядок в типе — порядок в списке клиники: выпечка, затем хлеб, после
    # напитков. ADD VALUE внутри транзакции PostgreSQL 16 разрешает; новым
    # значением в той же транзакции мы не пользуемся.
    op.execute(sa.text("ALTER TYPE recipe_category ADD VALUE IF NOT EXISTS 'bakery' AFTER 'drink'"))
    op.execute(sa.text("ALTER TYPE recipe_category ADD VALUE IF NOT EXISTS 'bread' AFTER 'bakery'"))


def downgrade() -> None:
    bind = op.get_bind()

    # Убрать значение из типа можно только пересозданием типа. Рецепты с новыми
    # категориями при этом потеряли бы раздел, поэтому откат на таких данных
    # отказывает, а не выполняется частично.
    used = bind.scalar(
        sa.text("SELECT count(*) FROM recipes WHERE category::text IN ('bakery', 'bread')")
    )
    if used:
        raise RuntimeError(
            f"Откат невозможен: {used} рецептов отнесены к выпечке или хлебу. "
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
