"""custom dish author

Who saved a child's dish (family-channel audit 26.11.2026, 1.6): a family
overwrote or deleted a portion the dietitian had calculated without being
told whose it was. Existing dishes keep NULL — their author is not known.

Revision ID: c11ca794bf6b
Revises: 518ab0d11733
Create Date: 2026-11-26 22:13:42.822211

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c11ca794bf6b"
down_revision: str | None = "518ab0d11733"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("custom_dishes", sa.Column("created_by", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "custom_dishes_created_by_fkey",
        "custom_dishes",
        "users",
        ["created_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("custom_dishes_created_by_fkey", "custom_dishes", type_="foreignkey")
    op.drop_column("custom_dishes", "created_by")
