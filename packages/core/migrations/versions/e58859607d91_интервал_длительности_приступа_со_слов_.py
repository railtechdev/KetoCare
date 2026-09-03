"""Интервал длительности приступа со слов семьи

Revision ID: e58859607d91
Revises: 36d26bd071c3
Create Date: 2026-09-03 15:00:45.349207

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e58859607d91"
down_revision: str | None = "36d26bd071c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Длительность со слов семьи — ссылкой на шкалу анкеты, а не числом в
    # `duration_sec`: интервал, пересчитанный в секунды (хоть нижней границей,
    # хоть серединой), становится неотличим от засечённого секундомером
    # (ADR-0020). Колонка nullable: у записей до этой миграции интервала нет, и
    # выдумывать его задним числом нельзя.
    op.add_column("seizure_logs", sa.Column("duration_option_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_seizure_logs_duration_option_id",
        "seizure_logs",
        "intake_options",
        ["duration_option_id"],
        ["id"],
        # RESTRICT, а не CASCADE: вариант шкалы, на который ссылается запись
        # дневника, удалить нельзя — иначе исчезла бы длительность приступа
        # ребёнка. Выводить варианты из употребления умеет `retired_at`.
        ondelete="RESTRICT",
    )
    # Индекс на внешний ключ — общий инвариант схемы (раздел 4 ТЗ): без него
    # проверка RESTRICT при правке справочника читает таблицу дневника целиком.
    op.create_index("ix_seizure_logs_duration_option_id", "seizure_logs", ["duration_option_id"])


def downgrade() -> None:
    op.drop_index("ix_seizure_logs_duration_option_id", table_name="seizure_logs")
    op.drop_constraint("fk_seizure_logs_duration_option_id", "seizure_logs", type_="foreignkey")
    op.drop_column("seizure_logs", "duration_option_id")
