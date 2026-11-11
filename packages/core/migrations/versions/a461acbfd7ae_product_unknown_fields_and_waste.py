"""product unknown fields and waste

Revision ID: a461acbfd7ae
Revises: c84735b24688
Create Date: 2026-11-11 23:42:24.750403

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a461acbfd7ae"
down_revision: str | None = "c84735b24688"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "unknown_fields",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column("products", sa.Column("waste_pct", sa.Numeric(precision=5, scale=2)))
    # Autogenerate does not see check constraints; written by hand.
    op.create_check_constraint(
        "ck_products_unknown_fields_is_array",
        "products",
        "jsonb_typeof(unknown_fields) = 'array'",
    )
    op.create_check_constraint(
        "ck_products_waste_pct_range",
        "products",
        "waste_pct IS NULL OR (waste_pct >= 0 AND waste_pct < 100)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_products_waste_pct_range", "products", type_="check")
    op.drop_constraint("ck_products_unknown_fields_is_array", "products", type_="check")
    op.drop_column("products", "waste_pct")
    op.drop_column("products", "unknown_fields")
