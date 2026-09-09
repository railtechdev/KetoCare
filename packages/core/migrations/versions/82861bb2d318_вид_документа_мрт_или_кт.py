"""вид документа МРТ или КТ

Revision ID: 82861bb2d318
Revises: e73d6d812ac8
Create Date: 2026-09-09 15:51:59.981795

Просила заказчица — «МРТ добавить» на снимке формы документов. Одним значением
вместе с КТ: снимки кладут в один ряд и смотрят вместе, а заводить второе
значение позже — вторая миграция ради одного слова.

**Автогенерация этого не видит.** Alembic сравнивает таблицы и колонки, а не
состав перечислений: сгенерированная ревизия была пустой. Поэтому здесь
рукописный `ALTER TYPE`, а не `op.alter_column`.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "82861bb2d318"
down_revision: str | None = "e73d6d812ac8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VALUES_BEFORE = ("discharge", "eeg", "lab", "prescription", "other")
_NEW_VALUE = "imaging"


def upgrade() -> None:
    # Значение встаёт сразу после «ЭЭГ»: порядок в типе — это порядок в списке,
    # а снимки читают рядом с исследованиями, а не после «иного».
    #
    # PostgreSQL 16 разрешает ADD VALUE внутри транзакции; пользоваться новым
    # значением в той же транзакции нельзя, и мы этого не делаем.
    op.execute(
        sa.text(
            f"ALTER TYPE attachment_doc_kind ADD VALUE IF NOT EXISTS '{_NEW_VALUE}' AFTER 'eeg'"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()

    # Убрать значение из типа можно только пересозданием типа. Документы,
    # помеченные снимками, при этом потеряли бы вид, поэтому откат на таких
    # данных отказывает, а не выполняется частично.
    used = bind.scalar(
        sa.text("SELECT count(*) FROM attachments WHERE doc_kind = :value"),
        {"value": _NEW_VALUE},
    )
    if used:
        raise RuntimeError(
            f"Откат невозможен: {used} документов помечены видом «{_NEW_VALUE}». "
            "Сначала переставьте им другой вид."
        )

    values = ", ".join(f"'{value}'" for value in _VALUES_BEFORE)
    op.execute(sa.text(f"CREATE TYPE attachment_doc_kind_old AS ENUM ({values})"))
    op.execute(
        sa.text(
            "ALTER TABLE attachments ALTER COLUMN doc_kind "
            "TYPE attachment_doc_kind_old USING doc_kind::text::attachment_doc_kind_old"
        )
    )
    op.execute(sa.text("DROP TYPE attachment_doc_kind"))
    op.execute(sa.text("ALTER TYPE attachment_doc_kind_old RENAME TO attachment_doc_kind"))
