"""leads from landing

Revision ID: 89b80c54c7a1
Revises: 991cefd07d30
Create Date: 2026-08-30 15:20:14.850526

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "89b80c54c7a1"
down_revision: str | None = "991cefd07d30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "leads",
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column(
            "audience",
            sa.Enum("family", "doctor", name="lead_audience"),
            nullable=False,
        ),
        sa.Column("locale", sa.String(length=16), nullable=False),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", "audience", name="uq_lead_email_audience"),
    )
    op.create_index("ix_leads_created_at", "leads", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_leads_created_at", table_name="leads")
    op.drop_table("leads")
    # Тип не исчезает вместе с таблицей: без этого повторный upgrade падает на
    # «type lead_audience already exists». Тот же приём — в 901f9beb69ae.
    op.execute("DROP TYPE IF EXISTS lead_audience")
