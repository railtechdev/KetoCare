"""telegram binding secret and active-chat partial unique

Revision ID: 1b95143eff9b
Revises: bce695d76e00
Create Date: 2026-08-30 03:23:19.365683

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1b95143eff9b"
down_revision: str | None = "bce695d76e00"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Второй фактор доступа бота (ADR-0009). Колонка добавляется nullable, затем
    # заполняется и только потом становится обязательной: `nullable=False` сразу
    # уронил бы миграцию на непустой таблице, а DoD требует применимости и к базе
    # с данными.
    op.add_column(
        "telegram_accounts", sa.Column("secret_hash", sa.String(length=64), nullable=True)
    )

    # Привязки, созданные до появления секрета, аутентифицироваться не могут:
    # секрета у бота для них нет и взяться ему неоткуда. Они помечаются
    # отозванными, а не удаляются (правило 4), и получают заведомо недостижимое
    # значение хеша — пустая строка сюда не годится, иначе `sha256("")` от
    # клиента совпал бы с хранимым. Ручек, создающих такие строки, никогда не
    # существовало, так что на практике цикл не затронет ни одной записи.
    op.execute(
        "UPDATE telegram_accounts "
        "SET secret_hash = md5(random()::text) || md5(random()::text), "
        "    revoked_at = COALESCE(revoked_at, now()) "
        "WHERE secret_hash IS NULL"
    )
    op.alter_column("telegram_accounts", "secret_hash", nullable=False)

    # Уникальность chat_id — только среди живых привязок. Глобальная делала
    # повторную привязку того же чата после отзыва невозможной как новую строку.
    op.drop_constraint(op.f("telegram_accounts_chat_id_key"), "telegram_accounts", type_="unique")
    op.create_index(
        "ix_telegram_accounts_parent_id", "telegram_accounts", ["parent_id"], unique=False
    )
    op.create_index(
        "ix_telegram_accounts_patient_id", "telegram_accounts", ["patient_id"], unique=False
    )
    op.create_index(
        "uq_telegram_accounts_active_chat",
        "telegram_accounts",
        ["chat_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    # Откат возможен не всегда, и молча ломаться он не должен.
    #
    # Прежняя схема требует глобальной уникальности `chat_id`, а новая допускает
    # несколько строк на один чат — одну живую плюс отозванные. Это не побочный
    # эффект, а смысл изменения: перепривязка после отзыва создаёт новую строку и
    # сохраняет журнал. Как только такая пара появилась, вернуть глобальный
    # UNIQUE без потери данных нельзя.
    #
    # Без этой проверки откат падал бы позже и невнятно — IntegrityError из
    # середины DDL, без указания, какие именно строки мешают. CI её не ловит:
    # он откатывает пустую базу.
    #
    # Удалять привязки автоматически миграция не будет: это журнал того, кому и
    # к какому ребёнку принадлежал чат.
    duplicates = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT chat_id, count(*) AS n FROM telegram_accounts "
                "GROUP BY chat_id HAVING count(*) > 1 ORDER BY n DESC LIMIT 5"
            )
        )
        .fetchall()
    )
    if duplicates:
        listed = ", ".join(f"chat_id={row[0]} ({row[1]} строк)" for row in duplicates)
        raise RuntimeError(
            "Откат невозможен без потери данных: в telegram_accounts есть чаты с "
            f"несколькими привязками ({listed}). Прежняя схема требует уникального "
            "chat_id — решите вручную, какие строки сохранить, и повторите откат."
        )

    op.drop_index(
        "uq_telegram_accounts_active_chat",
        table_name="telegram_accounts",
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.drop_index("ix_telegram_accounts_patient_id", table_name="telegram_accounts")
    op.drop_index("ix_telegram_accounts_parent_id", table_name="telegram_accounts")
    op.create_unique_constraint(
        op.f("telegram_accounts_chat_id_key"),
        "telegram_accounts",
        ["chat_id"],
        postgresql_nulls_not_distinct=False,
    )
    op.drop_column("telegram_accounts", "secret_hash")
