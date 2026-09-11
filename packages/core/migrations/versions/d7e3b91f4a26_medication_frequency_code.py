"""medication frequency code

Кратность приёма препарата выбирается из списка (ADR-0033, вопрос 45): коды
кратности HL7 FHIR плюс «по требованию» и «другая схема». Текстовая колонка
остаётся уточнением («утром и на ночь») и необязательна, но у записей,
заведённых до списка, в ней вся кратность — и перевести её в код без врача
нельзя. Поэтому код у старых строк пустой, а ограничение требует, чтобы
кратность была описана хотя бы одним способом.

Revision ID: d7e3b91f4a26
Revises: c4a9e2d17b35
Create Date: 2026-09-11 12:40:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d7e3b91f4a26"
down_revision: str | None = "c4a9e2d17b35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

VALUES = (
    "once_daily",
    "twice_daily",
    "three_times_daily",
    "four_times_daily",
    "every_other_day",
    "as_needed",
    "other",
)

# Тип создаётся явно: add_column сам CREATE TYPE не делает.
MEDICATION_FREQUENCY = postgresql.ENUM(*VALUES, name="medication_frequency", create_type=False)

#: Подписи — только для отката: там код переводится обратно в слова, иначе
#: кратность, заданная одним кодом, пропала бы вместе с колонкой.
LABELS = {
    "once_daily": "1 раз в сутки",
    "twice_daily": "2 раза в сутки",
    "three_times_daily": "3 раза в сутки",
    "four_times_daily": "4 раза в сутки",
    "every_other_day": "Через день",
    "as_needed": "По требованию",
    "other": "Другая схема",
}


def upgrade() -> None:
    postgresql.ENUM(*VALUES, name="medication_frequency").create(op.get_bind())
    op.add_column(
        "medications",
        sa.Column("frequency_code", MEDICATION_FREQUENCY, nullable=True),
    )
    op.alter_column("medications", "frequency", existing_type=sa.VARCHAR(length=255), nullable=True)
    op.create_check_constraint(
        "ck_medications_frequency_described",
        "medications",
        "(frequency_code IS NOT NULL AND frequency_code <> 'other') OR frequency IS NOT NULL",
    )


def downgrade() -> None:
    # Код возвращается словами перед строкой уточнения: «2 раза в сутки — утром
    # и на ночь». Без этого откат молча стёр бы кратность у всех записей,
    # заведённых после списка.
    cases = " ".join(f"WHEN '{code}' THEN '{label}'" for code, label in LABELS.items())
    op.execute(
        "UPDATE medications SET frequency = "
        f"(CASE frequency_code {cases} END) || COALESCE(' — ' || frequency, '') "
        "WHERE frequency_code IS NOT NULL AND frequency_code <> 'other'"
    )
    op.drop_constraint("ck_medications_frequency_described", "medications", type_="check")
    op.alter_column(
        "medications", "frequency", existing_type=sa.VARCHAR(length=255), nullable=False
    )
    op.drop_column("medications", "frequency_code")
    postgresql.ENUM(*VALUES, name="medication_frequency").drop(op.get_bind())
