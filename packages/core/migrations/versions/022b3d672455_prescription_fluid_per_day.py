"""prescription fluid per day

Optional daily fluid volume in a prescription (Holliday-Segar hint, ADR-0069).
Nullable: prescriptions written before it have no fluid, and the doctor may
leave the field empty. Append-only semantics of the table do not change.

Revision ID: 022b3d672455
Revises: a461acbfd7ae
Create Date: 2026-11-12 02:47:05.500554

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "022b3d672455"
down_revision: str | None = "a461acbfd7ae"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("prescriptions", sa.Column("fluid_ml_per_day", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("prescriptions", "fluid_ml_per_day")
