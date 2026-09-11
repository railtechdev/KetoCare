"""приглашение второго родителя к заведённому ребёнку

Revision ID: c4a9e2d17b35
Revises: 57f8e9cd5292
Create Date: 2026-09-11 12:40:00.000000

Ответ клиники от 09.09.2026 на вопрос 33: «Лучше через врача пригласить второго
родителя». Приглашение умело звать только первого родителя — того, кто сам
заведёт ребёнка. Второй родитель, приняв такое приглашение, видел «Ребёнок ещё
не заведён» и заводил двойника (docs/AUDIT_JOURNEY.md, ADR-0032).

**Заполнять нечем, и это не упущение.** У прежних приглашений ребёнка не было
ни в каком виде; у новых приглашений персонала и первого родителя его нет по
смыслу.

**Откат** уносит только связь непринятых приглашений с ребёнком: они станут
приглашениями первого родителя, и принявший их никакого доступа не получит.
Принятые уже превратились в строки `parent_patient` и откатом не затрагиваются.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4a9e2d17b35"
down_revision: str | None = "57f8e9cd5292"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Имя ограничения задано явно: автогенерация оставляет None, и downgrade() с
# drop_constraint(None) падает — как и в a3628c6cf7fa.
FK_NAME = "fk_invitations_patient_id_patients"
INDEX_NAME = "ix_invitations_patient_id"


def upgrade() -> None:
    op.add_column("invitations", sa.Column("patient_id", sa.UUID(), nullable=True))
    op.create_index(INDEX_NAME, "invitations", ["patient_id"], unique=False)
    op.create_foreign_key(FK_NAME, "invitations", "patients", ["patient_id"], ["id"])


def downgrade() -> None:
    op.drop_constraint(FK_NAME, "invitations", type_="foreignkey")
    op.drop_index(INDEX_NAME, table_name="invitations")
    op.drop_column("invitations", "patient_id")
