"""account without email for telegram parents

Родитель приходит из Telegram, и почты с паролем у него может не быть вовсе
(ADR-0040, этап Б). Колонки становятся необязательными, единственность почты
переезжает в частичный индекс (обычный UNIQUE пропустил бы сколько угодно NULL,
но и не дал бы выразить «только среди заполненных»), а вместо утраченного
NOT NULL появляется ограничение `users_staff_have_credentials`: пустой вход
разрешён ровно роли `parent`.

**Откат.** Учётные записи без почты или пароля НЕ проходят возвращаемый NOT NULL.
Удалять их downgrade не имеет права — это живые родители со связями с детьми,
дневниками и перепиской. Поэтому откат сначала пересчитывает такие строки и,
если они есть, останавливается с их перечнем: администратор обязан решить судьбу
каждой (задать почту через `/users/me/credentials` от её имени или удалить
`core.tools.erase_patient`-порядком), а не узнать о ней по молча удалённым данным.

Revision ID: cca065f2d1a6
Revises: fb62dcddae20
Create Date: 2026-09-16 15:11:48.828216

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "cca065f2d1a6"
down_revision: str | None = "fb62dcddae20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("telegram_user_id", sa.BIGINT(), nullable=True))
    op.alter_column("users", "email", existing_type=postgresql.CITEXT(), nullable=True)
    op.alter_column("users", "password_hash", existing_type=sa.VARCHAR(length=255), nullable=True)
    op.drop_constraint(op.f("users_email_key"), "users", type_="unique")
    op.create_index(
        "uq_users_email",
        "users",
        ["email"],
        unique=True,
        postgresql_where=sa.text("email IS NOT NULL"),
    )
    op.create_index(
        "uq_users_telegram_user_id",
        "users",
        ["telegram_user_id"],
        unique=True,
        postgresql_where=sa.text("telegram_user_id IS NOT NULL"),
    )
    op.create_check_constraint(
        "users_staff_have_credentials",
        "users",
        "role = 'parent' OR (email IS NOT NULL AND password_hash IS NOT NULL)",
    )


def downgrade() -> None:
    stranded = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT id, full_name FROM users "
                "WHERE email IS NULL OR password_hash IS NULL ORDER BY created_at"
            )
        )
        .fetchall()
    )
    if stranded:
        listed = ", ".join(f"{row.id} ({row.full_name})" for row in stranded)
        raise RuntimeError(
            "Откат невозможен без потери учётных записей: вход по почте отсутствует "
            f"у {len(stranded)} — {listed}. Задайте им почту и пароль либо удалите их "
            "сознательно, затем повторите откат."
        )

    op.drop_constraint("users_staff_have_credentials", "users", type_="check")
    op.drop_index(
        "uq_users_telegram_user_id",
        table_name="users",
        postgresql_where=sa.text("telegram_user_id IS NOT NULL"),
    )
    op.drop_index(
        "uq_users_email", table_name="users", postgresql_where=sa.text("email IS NOT NULL")
    )
    op.create_unique_constraint(op.f("users_email_key"), "users", ["email"])
    op.alter_column("users", "password_hash", existing_type=sa.VARCHAR(length=255), nullable=False)
    op.alter_column("users", "email", existing_type=postgresql.CITEXT(), nullable=False)
    op.drop_column("users", "telegram_user_id")
