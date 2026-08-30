"""users password change required

Revision ID: eff24e51f587
Revises: 991cefd07d30
Create Date: 2026-08-30 15:54:50.958842

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "eff24e51f587"
down_revision: str | None = "991cefd07d30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # `server_default` обязателен: колонка NOT NULL добавляется к таблице с
    # существующими учётными записями, и без значения по умолчанию ALTER упал бы
    # на первой же непустой базе.
    op.add_column(
        "users",
        sa.Column(
            "password_change_required",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "password_change_required")
