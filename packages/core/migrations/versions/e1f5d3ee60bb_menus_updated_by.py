"""menus.updated_by — who last composed the day plan (ADR-0047).

Revision ID: e1f5d3ee60bb
Revises: e1adc8579629
Create Date: 2026-10-05 11:00:40.097874

The day plan is now composed by the family and by the leading specialist alike
(customer decision G2), and both sides need to see whose plan it is. Existing
rows stay NULL: who saved them last is not recorded anywhere, and guessing it
from `created_by` would put a name under a plan that person may not have made.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1f5d3ee60bb"
down_revision: str | None = "e1adc8579629"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("menus", sa.Column("updated_by", sa.UUID(), nullable=True))
    op.create_foreign_key(op.f("menus_updated_by_fkey"), "menus", "users", ["updated_by"], ["id"])


def downgrade() -> None:
    op.drop_constraint(op.f("menus_updated_by_fkey"), "menus", type_="foreignkey")
    op.drop_column("menus", "updated_by")
