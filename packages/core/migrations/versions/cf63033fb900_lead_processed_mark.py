"""lead processed mark

Revision ID: cf63033fb900
Revises: 022b3d672455
Create Date: 2026-11-12 18:14:29.168160

Отметка «заявка обработана» (ADR-0072): когда и кем. Обе колонки пустые у
всех существующих заявок — они считаются новыми, и администратор отметит
отвеченные сам: по базе нельзя узнать, кому уже написали.

Откат убирает колонки вместе с отметками; сами заявки остаются.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cf63033fb900"
down_revision: str | None = "022b3d672455"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Имя задано явно: PostgreSQL дал бы своё, а `drop_constraint(None)` в откате
# падает — миграция стала бы необратимой.
FK_NAME = "leads_processed_by_fkey"


def upgrade() -> None:
    op.add_column("leads", sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("leads", sa.Column("processed_by", sa.UUID(), nullable=True))
    op.create_index("ix_leads_processed_by", "leads", ["processed_by"], unique=False)
    op.create_foreign_key(FK_NAME, "leads", "users", ["processed_by"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint(FK_NAME, "leads", type_="foreignkey")
    op.drop_index("ix_leads_processed_by", table_name="leads")
    op.drop_column("leads", "processed_by")
    op.drop_column("leads", "processed_at")
