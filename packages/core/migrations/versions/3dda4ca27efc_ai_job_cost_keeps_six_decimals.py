"""ai job cost keeps six decimals

With providers and a catalogue of models (ADR-0082) a call may cost fractions
of a cent: a cheap or self-hosted model at $0.10 per million tokens. Four
decimals rounded such a call to zero, and a thousand of them left no trace in
the budget. Widening only: existing values keep their meaning.

Revision ID: 3dda4ca27efc
Revises: b7e4c2a91d06
Create Date: 2026-11-15 02:26:43.067281

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3dda4ca27efc"
down_revision: str | None = "b7e4c2a91d06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "ai_jobs",
        "cost_usd",
        existing_type=sa.NUMERIC(precision=8, scale=4),
        type_=sa.Numeric(precision=12, scale=6),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "ai_jobs",
        "cost_usd",
        existing_type=sa.Numeric(precision=12, scale=6),
        type_=sa.NUMERIC(precision=8, scale=4),
        existing_nullable=True,
    )
