"""users password_changed_at

Отметка последней смены пароля. Раздел 11 ТЗ требует ревокации сессий при смене
пароля, а refresh-токены у нас без состояния — хранилища выданных токенов нет.
Отметка попадает в токен claim"ом `pwd`, и токен, выданный до смены, отвергается.

Столбец nullable: у существующих учётных записей пароль ещё не меняли, и
выдумывать им дату нельзя — иначе все текущие сессии оборвутся на пустом месте.

Revision ID: 16c703b6408c
Revises: a3628c6cf7fa
Create Date: 2026-08-28 17:34:56.011005

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "16c703b6408c"
down_revision: str | None = "a3628c6cf7fa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("password_changed_at", sa.TIMESTAMP(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "password_changed_at")
