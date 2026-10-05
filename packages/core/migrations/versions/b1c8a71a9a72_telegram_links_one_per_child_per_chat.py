"""telegram links: one live link per child per chat (ADR-0048)

Чат может вести нескольких детей: уникальной среди живых привязок становится
пара `(chat_id, patient_id)`, а не один `chat_id`.

Revision ID: b1c8a71a9a72
Revises: 62f102316036
Create Date: 2026-10-05 14:28:24.821703

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b1c8a71a9a72"
down_revision: str | None = "62f102316036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index(
        op.f("uq_telegram_accounts_active_chat"),
        table_name="telegram_accounts",
        postgresql_where="(revoked_at IS NULL)",
    )
    op.create_index(
        "uq_telegram_accounts_active_chat_patient",
        "telegram_accounts",
        ["chat_id", "patient_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    # Прежний индекс не встанет, пока у чата больше одной живой привязки. Как и
    # откат `1b95143eff9b`, миграция сама ничего не отзывает: отзыв закрыл бы
    # семье дневник второго ребёнка, и решать, чей доступ снять, — человеку.
    # Проверка — до DDL, чтобы откат не падал невнятным IntegrityError.
    busy = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT chat_id, count(*) AS n FROM telegram_accounts "
                "WHERE revoked_at IS NULL GROUP BY chat_id HAVING count(*) > 1 "
                "ORDER BY n DESC LIMIT 5"
            )
        )
        .fetchall()
    )
    if busy:
        listed = ", ".join(f"chat_id={row[0]} ({row[1]} детей)" for row in busy)
        raise RuntimeError(
            "Откат невозможен без потери доступа: есть чаты, ведущие нескольких детей "
            f"({listed}). Прежняя схема разрешает чату одну живую привязку — решите, "
            "какие отозвать (POST /patients/{id}/telegram/{link_id}/revoke), и повторите откат."
        )

    op.drop_index(
        "uq_telegram_accounts_active_chat_patient",
        table_name="telegram_accounts",
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        op.f("uq_telegram_accounts_active_chat"),
        "telegram_accounts",
        ["chat_id"],
        unique=True,
        postgresql_where="(revoked_at IS NULL)",
    )
