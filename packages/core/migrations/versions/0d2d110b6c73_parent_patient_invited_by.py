"""parent patient invited by

Кто открыл взрослому доступ к ребёнку — теперь свойство самой связи (ADR-0043).
От него зависит, кто вправе этот доступ закрыть: пригласивший — да, остальные
родители — нет.

Выводить пригласившего из истории кодов нельзя: код, погашенный уже
подключённым взрослым (второй телефон), сделал бы «пригласившим» постороннего
для этой связи человека, и бабушка смогла бы закрыть доступ маме.

Заполнение уже существующих связей — по коду, погашенному в пределах минуты от
создания связи: связь и погашение кода происходят в одной транзакции, и такой
код и есть тот, что её создал. Связи без такого кода остаются пустыми — их
закрывает только врач или сам взрослый, то есть ровно как до этой миграции.

Откат удаляет колонку; закрыть доступ после него может только врач и сам
взрослый (поведение до ADR-0043 — никто).

Revision ID: 0d2d110b6c73
Revises: c4c275f1ce9e
Create Date: 2026-10-02 18:49:15.700573

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0d2d110b6c73"
down_revision: str | None = "c4c275f1ce9e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("parent_patient", sa.Column("invited_by", sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f("parent_patient_invited_by_fkey"),
        "parent_patient",
        "users",
        ["invited_by"],
        ["id"],
    )
    op.execute(
        """
        UPDATE parent_patient AS pp
        SET invited_by = first_code.issued_by
        FROM (
            SELECT DISTINCT ON (c.used_by, c.patient_id)
                   c.used_by, c.patient_id, c.issued_by, c.used_at
            FROM access_codes AS c
            WHERE c.used_by IS NOT NULL
              AND c.purpose = 'family_member'
            ORDER BY c.used_by, c.patient_id, c.used_at
        ) AS first_code
        WHERE first_code.used_by = pp.parent_id
          AND first_code.patient_id = pp.patient_id
          AND first_code.used_at BETWEEN pp.created_at - interval '1 minute'
                                     AND pp.created_at + interval '1 minute'
        """
    )


def downgrade() -> None:
    op.drop_constraint(op.f("parent_patient_invited_by_fkey"), "parent_patient", type_="foreignkey")
    op.drop_column("parent_patient", "invited_by")
