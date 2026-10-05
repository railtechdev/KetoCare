"""users language

Язык семейных каналов — бота, Mini App и сообщений воркера (ADR-0052, решение
заказчика G3). Колонка пустая у всех существующих учётных записей: пусто
означает «человек не выбирал», и сообщения ему идут по-русски, как и до
миграции. Заполнять её задним числом нечем — язык Telegram сервер узнаёт только
при следующем входе в Mini App или привязке в боте.

Revision ID: 8efa7badda3a
Revises: 4fdbbc0c4e38
Create Date: 2026-10-05 16:09:25.391340

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8efa7badda3a"
down_revision: str | None = "4fdbbc0c4e38"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("language", sa.String(length=8), nullable=True))
    op.create_check_constraint("users_language_known", "users", "language IN ('ru', 'uz')")


def downgrade() -> None:
    op.drop_constraint("users_language_known", "users", type_="check")
    op.drop_column("users", "language")
