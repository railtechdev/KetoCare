"""invitations created_by

Кто выдал приглашение. Раздел 4.2 задаёт `users.invited_by`, но заполнить его при
принятии приглашения было нечем — сама заявка автора не хранила. Для семьи это не
просто след: пригласивший врач или диетолог становится ведущим специалистом её
ребёнка (docs/adr/0003-onboarding-and-patient-links.md).

Столбец nullable: у уже существующих приглашений автора нет, и выдумывать его
нельзя.

Revision ID: a3628c6cf7fa
Revises: 8e85f89b05ba
Create Date: 2026-08-28 15:26:09.709037

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3628c6cf7fa"
down_revision: str | None = "8e85f89b05ba"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Имя ограничения задано явно: автогенерация оставляет None, и downgrade() с
# drop_constraint(None) падает — то есть миграция была бы необратимой.
FK_NAME = "fk_invitations_created_by_users"


def upgrade() -> None:
    op.add_column("invitations", sa.Column("created_by", sa.UUID(), nullable=True))
    op.create_foreign_key(FK_NAME, "invitations", "users", ["created_by"], ["id"])


def downgrade() -> None:
    op.drop_constraint(FK_NAME, "invitations", type_="foreignkey")
    op.drop_column("invitations", "created_by")
