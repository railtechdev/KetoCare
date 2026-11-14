"""app settings changed from the admin area

Revision ID: b7e4c2a91d06
Revises: a3d91c5e7b20
Create Date: 2026-11-14

Настройки, которые администратор меняет из кабинета (ADR-0080): ключ поставщика
ИИ (зашифрованным), модели, бюджеты и лимиты групп задач. Пустая таблица — стенд
работает по окружению, как до неё. Откат теряет заданные в кабинете значения,
стенд возвращается к окружению.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b7e4c2a91d06"
down_revision: str | None = "a3d91c5e7b20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_by", sa.UUID(), nullable=True),
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
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
