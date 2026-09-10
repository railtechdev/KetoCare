"""признак «это лекарство» в справочнике aed_drugs

Revision ID: 3847f44df7d0
Revises: 82861bb2d318
Create Date: 2026-09-10 16:43:35.368068

В `aed_drugs` живут не только препараты. Справочник заводился под анкету семьи
(«какие препараты принимает»), и вариантами ответа там же стоят «Другое
(указать)», «Не принимает противоэпилептические препараты» и «Не знаю
названия» — три последние строки сида.

Пока справочник читала только анкета, это ничему не мешало: варианты ответа там
и должны быть. Но схема лекарственной терапии стала подсказывать названия из
того же справочника, и врач, набравший «не», получал в подсказке «Не знаю
названия» — а выбор подставлял эту строку в `drug_name` как каноническое
название препарата.

**Почему признаком, а не списком имён в коде.** Справочник ведёт медкоманда
через админку и заведёт новые служебные строки, о которых код не узнает. Отсев
по названию — догадка, которая молча перестанет работать.

Данные помечает эта же миграция: три строки известны поимённо, потому что их
завёл наш сид (`bce695d76e00`). Всё остальное — препараты, поэтому умолчание
`true`, а не `false`.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3847f44df7d0"
down_revision: str | None = "82861bb2d318"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Строки сида, которые называют не лекарство, а вариант ответа анкеты.
_NOT_DRUGS = (
    "Другое (указать)",
    "Не принимает противоэпилептические препараты",
    "Не знаю названия",
)


def upgrade() -> None:
    op.add_column(
        "aed_drugs",
        sa.Column("is_drug", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.execute(
        sa.text("UPDATE aed_drugs SET is_drug = false WHERE name_ru = ANY(:names)").bindparams(
            sa.bindparam("names", value=list(_NOT_DRUGS), type_=sa.ARRAY(sa.String))
        )
    )


def downgrade() -> None:
    op.drop_column("aed_drugs", "is_drug")
