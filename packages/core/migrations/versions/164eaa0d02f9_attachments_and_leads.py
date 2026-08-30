"""attachments and leads

Revision ID: 164eaa0d02f9
Revises: 699ac0155e07, 89b80c54c7a1
Create Date: 2026-08-30 20:54:51.507530

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "164eaa0d02f9"
down_revision: tuple[str, str] = ("699ac0155e07", "89b80c54c7a1")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Сводит две ветви истории в одну — схему не меняет.

    Подсистема файлов (`699ac0155e07`) и приём заявок с лендинга
    (`89b80c54c7a1`) делались параллельно и обе ответвились от `991cefd07d30`.
    Без этой ревизии у alembic две головы, и `alembic upgrade head` отказывается
    работать вовсе: `make migrate` падает с «Multiple head revisions are
    present for given argument 'head'».
    """


def downgrade() -> None:
    """Обратно разводит ветви. Тоже без изменений схемы."""
