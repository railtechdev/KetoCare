"""prescriptions.created_at: now() -> clock_timestamp()

`now()` в PostgreSQL возвращает время НАЧАЛА ТРАНЗАКЦИИ и одинаково для всех строк,
вставленных в одной транзакции. Активное назначение определяется как "последнее по
created_at" (раздел 4.2 ТЗ) — при совпадении меток порядок недетерминирован, а это
кетосоотношение, по которому семья кормит ребёнка. `clock_timestamp()` берёт реальное
время на момент вставки конкретной строки.

Затрагивает только `prescriptions` — единственную append-only таблицу, где "последняя
строка" имеет клиническое значение.

Revision ID: 05d5a6177f33
Revises: 688c4b9bd8b0
Create Date: 2026-08-27 21:18:45.560891

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "05d5a6177f33"
down_revision: str | None = "688c4b9bd8b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "prescriptions",
        "created_at",
        server_default=sa.text("clock_timestamp()"),
        existing_type=sa.TIMESTAMP(timezone=True),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "prescriptions",
        "created_at",
        server_default=sa.text("now()"),
        existing_type=sa.TIMESTAMP(timezone=True),
        existing_nullable=False,
    )
