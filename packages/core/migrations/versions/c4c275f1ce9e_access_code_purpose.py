"""access code purpose

У кода доступа появляется назначение (ADR-0042): «свой чат» или «другой
взрослый». До этого назначение выводилось из роли выдавшего — любой код
родителя был кодом своего чата, — и открыть доступ второму взрослому родитель
не мог.

Существующие коды получают назначение по той же роли, по которой оно до сих пор
и выводилось: выдавший родитель — `own_chat`, специалист — `family_member`.
Поведение уже выданных кодов от этого не меняется.

Откат убирает колонку и тип. Коды, которые родитель успел выпустить для другого
взрослого, после отката снова читаются по роли — как код своего чата: в вебе
перестают действовать, а в боте привязывают чат к выдавшему. Поэтому перед
откатом такие непогашенные коды стоит отозвать.

Revision ID: c4c275f1ce9e
Revises: 600d231323d6
Create Date: 2026-10-02 14:18:51.490852

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c4c275f1ce9e"
down_revision: str | None = "600d231323d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

VALUES = ("own_chat", "family_member")
PURPOSE = postgresql.ENUM(*VALUES, name="access_code_purpose", create_type=False)


def upgrade() -> None:
    postgresql.ENUM(*VALUES, name="access_code_purpose").create(op.get_bind())
    op.add_column("access_codes", sa.Column("purpose", PURPOSE, nullable=True))
    op.execute(
        "UPDATE access_codes AS c SET purpose = "
        "CASE WHEN u.role = 'parent' THEN 'own_chat'::access_code_purpose "
        "ELSE 'family_member'::access_code_purpose END "
        "FROM users AS u WHERE u.id = c.issued_by"
    )
    op.alter_column("access_codes", "purpose", existing_type=PURPOSE, nullable=False)


def downgrade() -> None:
    op.drop_column("access_codes", "purpose")
    postgresql.ENUM(*VALUES, name="access_code_purpose").drop(op.get_bind())
