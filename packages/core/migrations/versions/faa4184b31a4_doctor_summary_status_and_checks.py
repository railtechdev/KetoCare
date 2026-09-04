"""doctor summary status and checks

Строка сводки заводится в момент заказа, до обращения к модели: сборка идёт
секунды, и врачу нужно что-то опрашивать. Отсюда `status`, необязательные
`draft_md`/`ai_job_id` и `error` — обоснование в ADR-0023.

`checks` — находки постфильтра по черновику. Хранятся, а не пересчитываются при
чтении: правила со временем меняются, а разбирать через полгода придётся именно
то, что видел врач.

Revision ID: faa4184b31a4
Revises: 376f3b526882
Create Date: 2026-09-04 14:38:37.217543

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "faa4184b31a4"
down_revision: str | None = "376f3b526882"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Тип уже создан начальной миграцией (его носит `ai_jobs.status`), поэтому
# create_type=False: без него add_column попытается CREATE TYPE и упадёт.
AI_JOB_STATUS = postgresql.ENUM(
    "queued", "running", "done", "failed", name="ai_job_status", create_type=False
)


def upgrade() -> None:
    # Значение по умолчанию — на время добавления колонки: у строк, заведённых
    # до этой миграции, черновик уже есть, и их состояние — «готово».
    op.add_column(
        "doctor_summaries",
        sa.Column("status", AI_JOB_STATUS, nullable=False, server_default="done"),
    )
    # Дальше состояние задаёт приложение, а не БД: серверный дефолт «done» на
    # новых строках означал бы готовую сводку без текста.
    op.alter_column("doctor_summaries", "status", server_default=None)

    op.add_column("doctor_summaries", sa.Column("requested_by", sa.UUID(), nullable=True))
    # Кто заказал — берём из вызова модели: до этой миграции строка без
    # `ai_job_id` существовать не могла.
    op.execute(
        "UPDATE doctor_summaries SET requested_by = ai_jobs.requested_by "
        "FROM ai_jobs WHERE ai_jobs.id = doctor_summaries.ai_job_id"
    )
    op.alter_column("doctor_summaries", "requested_by", nullable=False)
    op.create_foreign_key(
        "fk_doctor_summaries_requested_by", "doctor_summaries", "users", ["requested_by"], ["id"]
    )

    op.add_column(
        "doctor_summaries",
        sa.Column("checks", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column("doctor_summaries", sa.Column("error", sa.String(), nullable=True))
    op.add_column(
        "doctor_summaries", sa.Column("approved_at", sa.TIMESTAMP(timezone=True), nullable=True)
    )

    op.alter_column("doctor_summaries", "draft_md", existing_type=sa.VARCHAR(), nullable=True)
    op.alter_column("doctor_summaries", "ai_job_id", existing_type=sa.UUID(), nullable=True)


def downgrade() -> None:
    # Строки без черновика и без вызова модели откатить нельзя: колонки снова
    # станут обязательными, а значений для них не существует. Такие строки —
    # это заказы, не дошедшие до текста; они удаляются.
    op.execute("DELETE FROM doctor_summaries WHERE draft_md IS NULL OR ai_job_id IS NULL")

    op.drop_constraint("fk_doctor_summaries_requested_by", "doctor_summaries", type_="foreignkey")
    op.alter_column("doctor_summaries", "ai_job_id", existing_type=sa.UUID(), nullable=False)
    op.alter_column("doctor_summaries", "draft_md", existing_type=sa.VARCHAR(), nullable=False)
    op.drop_column("doctor_summaries", "approved_at")
    op.drop_column("doctor_summaries", "error")
    op.drop_column("doctor_summaries", "checks")
    op.drop_column("doctor_summaries", "requested_by")
    op.drop_column("doctor_summaries", "status")
