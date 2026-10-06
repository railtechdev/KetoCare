"""products counts_in_calculation

Отметка продукта «приправа — не учитывается в расчёте» (ADR-0054). Ответ
клиники от 09.09.2026 на вопрос 16: «соль, перец не учитываются в расчётах».

Существующие строки получают `true` — то есть считаются, как и раньше.
Ни один продукт миграция приправой не объявляет: что считать приправой,
решает диетолог отметкой в карточке. Поэтому расчёт уже сохранённых
рецептов, блюд и дней от этой ревизии не меняется.

Откат удаляет колонку: отметки, поставленные после ревизии, теряются, и
отмеченные продукты снова входят в расчёт новых записей.

Revision ID: aa3aa11e72c7
Revises: f739fbebd238
Create Date: 2026-10-06

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "aa3aa11e72c7"
down_revision: str | None = "f739fbebd238"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "counts_in_calculation",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("products", "counts_in_calculation")
