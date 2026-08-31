"""Отзыв приглашения.

Ссылка показывается один раз и не восстанавливается, а отозвать её было нечем:
ошибка в адресе означала действующее приглашение в чужой почтовый ящик, и
единственным выходом было ждать, пока оно истечёт.

Строка не удаляется, а помечается: по ней видно, кого звали и кто звал.

Revision ID: 63ef73331ab6
Revises: 8586aac37c54
Create Date: 2026-08-31 20:12:03.114620
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "63ef73331ab6"
down_revision: str | None = "8586aac37c54"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("invitations", sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("invitations", "revoked_at")
