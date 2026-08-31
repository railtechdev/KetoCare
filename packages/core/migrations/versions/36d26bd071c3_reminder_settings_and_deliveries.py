"""Настройки напоминаний и журнал отправленных (раздел 7.4 ТЗ).

`reminder_settings` — одна строка на ребёнка: напоминания про конкретного
ребёнка, а не про родителя. Время местное и без часового пояса: семья называет
«восемь вечера», а не момент UTC.

`reminder_deliveries` — след об отправке. Задача воркера идёт каждые пять минут,
а окно попадания шире одного тика: без следа одно напоминание уходило бы
несколько раз подряд. Уникальность по (ребёнок, вид, дата) делает повтор
невозможным на уровне базы, а не на уровне аккуратности кода.

Revision ID: 36d26bd071c3
Revises: 63ef73331ab6
Create Date: 2026-08-31 20:19:25.784264
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "36d26bd071c3"
down_revision: str | None = "63ef73331ab6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reminder_deliveries",
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("sent_on", sa.Date(), nullable=False),
        sa.Column("sent_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("chat_id", sa.BIGINT(), nullable=False),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_reminder_delivery_day",
        "reminder_deliveries",
        ["patient_id", "kind", "sent_on"],
        unique=True,
    )
    op.create_table(
        "reminder_settings",
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("ketones_at", sa.Time(), nullable=True),
        sa.Column("weight_at", sa.Time(), nullable=True),
        sa.Column("medications_at", sa.Time(), nullable=True),
        sa.Column("no_records_at", sa.Time(), nullable=True),
        sa.Column("updated_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_reminder_settings_patient", "reminder_settings", ["patient_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index("uq_reminder_settings_patient", table_name="reminder_settings")
    op.drop_table("reminder_settings")
    op.drop_index("uq_reminder_delivery_day", table_name="reminder_deliveries")
    op.drop_table("reminder_deliveries")
