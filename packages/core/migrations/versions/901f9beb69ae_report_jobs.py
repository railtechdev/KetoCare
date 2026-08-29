"""report jobs

Задача сборки PDF-отчёта (раздел 5.3 ТЗ: ручка возвращает job id, дальше
поллинг). Раздел 4.2 таблицы под это не предусматривает — расхождение
зафиксировано в docs/adr/0008-report-jobs.md.

Revision ID: 901f9beb69ae
Revises: 086d4c5d6d03
Create Date: 2026-08-29 22:57:55.746222

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "901f9beb69ae"
down_revision: str | None = "086d4c5d6d03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "report_jobs",
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("requested_by", sa.UUID(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("queued", "running", "done", "failed", name="report_job_status"),
            nullable=False,
        ),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("finished_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("report_jobs")
    op.execute("DROP TYPE IF EXISTS report_job_status")
