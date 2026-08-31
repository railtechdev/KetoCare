"""Снимок состава в позиции меню.

Позиция ссылается на рецепт или своё блюдо, а те живут своей жизнью: диетолог
правит рецепт, администратор — числа продукта. Без снимка правка задним числом
меняла прошлые дни при первом же их сохранении.

Колонка nullable: у позиций, сохранённых до неё, снимка нет и не будет —
восстанавливать его по текущему рецепту значило бы выдать сегодняшний состав за
тогдашний. Такие дни продолжают считаться по ссылке, как раньше.

Revision ID: 2c04bb896cfb
Revises: 91800456b812
Create Date: 2026-08-31 15:40:14.292968
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2c04bb896cfb"
down_revision: str | None = "91800456b812"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "menu_items",
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("menu_items", "snapshot")
