"""seed dictionaries

Раздел 4.2 ТЗ: `seizure_types`, `ketone_methods` — "справочники ... наполняются
миграцией-сидом; правятся админом".

`ketone_methods` — напрямую из текста ТЗ (раздел 7.3, сценарий бота "Кетоны":
"метод (Кровь/Моча)").

`seizure_types` — ТЗ не даёт конкретный список (раздел 7.3: "тип (кнопки из
справочника)" без перечисления). Список ниже — provisional, стандартная
классификация ILAE на русском; отредактируется медицинской командой через
админку без новой миграции (правки — не через миграции, "правятся админом").
См. docs/medical/OPEN_QUESTIONS.md.

Revision ID: 688c4b9bd8b0
Revises: 89d9663051ae
Create Date: 2026-08-27 18:10:17.194462

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "688c4b9bd8b0"
down_revision: str | None = "89d9663051ae"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEIZURE_TYPES = [
    "Тонико-клонический",
    "Абсанс",
    "Миоклонический",
    "Атонический",
    "Тонический",
    "Клонический",
    "Фокальный",
    "Инфантильные спазмы",
    "Другой / неуточнённый",
]

KETONE_METHODS = ["Кровь", "Моча"]

seizure_types = sa.table(
    "seizure_types", sa.column("name_ru", sa.String), sa.column("sort", sa.Integer)
)
ketone_methods = sa.table(
    "ketone_methods", sa.column("name_ru", sa.String), sa.column("sort", sa.Integer)
)


def upgrade() -> None:
    op.bulk_insert(
        seizure_types,
        [{"name_ru": name, "sort": i} for i, name in enumerate(SEIZURE_TYPES)],
    )
    op.bulk_insert(
        ketone_methods,
        [{"name_ru": name, "sort": i} for i, name in enumerate(KETONE_METHODS)],
    )


def downgrade() -> None:
    op.execute(seizure_types.delete().where(seizure_types.c.name_ru.in_(SEIZURE_TYPES)))
    op.execute(ketone_methods.delete().where(ketone_methods.c.name_ru.in_(KETONE_METHODS)))
