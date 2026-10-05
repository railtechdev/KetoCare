"""reminder delivery per chat

Право на отправку напоминания занимается на чат, а не на ребёнка: при двух
взрослых с Telegram напоминание получает каждый. Прежде первый занявший право
оставлял второго без напоминания (аудит блокеров, 05.10.2026).

Откат возвращает уникальность по ребёнку, виду и дню. Перед этим лишние строки
того же дня удаляются, иначе индекс не построится: это журнал отправок, а не
клинические данные, и в нём важно только «сегодня уже отправлено».

Revision ID: e1adc8579629
Revises: 0d2d110b6c73
Create Date: 2026-10-05 10:00:21.906645

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1adc8579629"
down_revision: str | None = "0d2d110b6c73"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index(op.f("uq_reminder_delivery_day"), table_name="reminder_deliveries")
    op.create_index(
        "uq_reminder_delivery_chat_day",
        "reminder_deliveries",
        ["patient_id", "kind", "sent_on", "chat_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_reminder_delivery_chat_day", table_name="reminder_deliveries")
    op.execute(
        """
        DELETE FROM reminder_deliveries AS d
        USING reminder_deliveries AS keep
        WHERE d.patient_id = keep.patient_id
          AND d.kind = keep.kind
          AND d.sent_on = keep.sent_on
          AND (d.sent_at, d.id) > (keep.sent_at, keep.id)
        """
    )
    op.create_index(
        op.f("uq_reminder_delivery_day"),
        "reminder_deliveries",
        ["patient_id", "kind", "sent_on"],
        unique=True,
    )
