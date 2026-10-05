"""recipe status without reviewed

Статус рецепта «на проверке» (`reviewed`) убран (ADR-0053): клиника ответила на
вопрос 32, что шаг рецензирования не нужен, а перевести рецепт в этот статус не
мог ни один путь в коде — значение было объявлено и недостижимо.

Убрать значение из типа PostgreSQL можно только пересозданием типа. Строк с ним
быть не должно; если такая всё же нашлась (ручная правка базы), она становится
черновиком — это безопасная сторона: черновик семьи не видят, а публикует его
снова человек. Отказывать в миграции из-за такой строки незачем: статус,
который ничего не значил, и черновик для неё равнозначны.

**Автогенерация этого не видит** (состав перечислений Alembic не сравнивает),
поэтому `ALTER TYPE` рукописный — как в ревизии 82861bb2d318.

Revision ID: 801c8afc64d3
Revises: 8efa7badda3a
Create Date: 2026-10-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "801c8afc64d3"
down_revision: str | None = "8efa7badda3a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VALUES_AFTER = ("draft", "published")
_VALUES_BEFORE = ("draft", "reviewed", "published")


def _recreate(values: Sequence[str]) -> None:
    listed = ", ".join(f"'{value}'" for value in values)
    op.execute(sa.text("ALTER TYPE recipe_status RENAME TO recipe_status_old"))
    op.execute(sa.text(f"CREATE TYPE recipe_status AS ENUM ({listed})"))
    op.execute(
        sa.text(
            "ALTER TABLE recipes ALTER COLUMN status "
            "TYPE recipe_status USING status::text::recipe_status"
        )
    )
    op.execute(sa.text("DROP TYPE recipe_status_old"))


def upgrade() -> None:
    op.execute(sa.text("UPDATE recipes SET status = 'draft' WHERE status = 'reviewed'"))
    _recreate(_VALUES_AFTER)


def downgrade() -> None:
    # Возврат значения ничего не теряет: в него не переведена ни одна строка.
    _recreate(_VALUES_BEFORE)
