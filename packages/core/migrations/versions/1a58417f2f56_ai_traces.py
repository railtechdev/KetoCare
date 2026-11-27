"""ai traces

How long each step of an AI task took (ADR-0094): durations only — no text,
no person, no child. The owner asked why the assistant answers slowly, and the
only timing kept so far was the model call in `ai_jobs`.

Revision ID: 1a58417f2f56
Revises: c11ca794bf6b
Create Date: 2026-11-28 01:05:20.302375

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "1a58417f2f56"
down_revision: str | None = "c11ca794bf6b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_traces",
        sa.Column(
            "kind",
            # The type exists since the first migration; this table only uses it.
            postgresql.ENUM(name="ai_job_kind", create_type=False),
            nullable=False,
        ),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.Column("steps", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("total_ms", sa.Integer(), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ai_traces_kind_created_at", "ai_traces", ["kind", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_ai_traces_kind_created_at", table_name="ai_traces")
    op.drop_table("ai_traces")
