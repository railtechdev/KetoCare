"""medication dose unit and partial last seizure date

ADR-0049, вопросы 44 и 48 — решения команды разработки по стандартам.

Доза препарата: число и единица из списка (HL7 FHIR `doseQuantity`, единицы
UCUM). Строка `dose` остаётся: у новых записей её собирает сервер, у записей
до списка в ней вся доза — и переводить её в число без врача нельзя, поэтому
у старых строк число и единица пустые.

Дата последнего приступа в анкете: рядом с датой — её точность (день, месяц,
год или «не помню»), как частичная дата FHIR. У заполненных анкет дата была
только полной, им проставляется «день».

Revision ID: 62f102316036
Revises: c1853b706740
Create Date: 2026-10-05 14:27:28.553485

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "62f102316036"
down_revision: str | None = "c1853b706740"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DOSE_UNITS = ("mg", "g", "mcg", "ml", "iu", "drop", "tablet", "capsule", "sachet", "other")
PRECISIONS = ("day", "month", "year", "unknown")

# Типы создаются явно: add_column сам CREATE TYPE не делает.
DOSE_UNIT = postgresql.ENUM(*DOSE_UNITS, name="medication_dose_unit", create_type=False)
PRECISION = postgresql.ENUM(*PRECISIONS, name="last_seizure_precision", create_type=False)


def upgrade() -> None:
    bind = op.get_bind()
    postgresql.ENUM(*DOSE_UNITS, name="medication_dose_unit").create(bind)
    postgresql.ENUM(*PRECISIONS, name="last_seizure_precision").create(bind)

    op.add_column(
        "medications", sa.Column("dose_value", sa.Numeric(precision=10, scale=3), nullable=True)
    )
    op.add_column("medications", sa.Column("dose_unit", DOSE_UNIT, nullable=True))
    op.create_check_constraint(
        "ck_medications_dose_quantity",
        "medications",
        "CASE WHEN dose_unit IS NULL OR dose_unit = 'other' THEN dose_value IS NULL "
        "ELSE dose_value IS NOT NULL AND dose_value > 0 END",
    )

    op.add_column("patient_intake", sa.Column("last_seizure_precision", PRECISION, nullable=True))
    # До этой ревизии дата была только полной.
    op.execute(
        "UPDATE patient_intake SET last_seizure_precision = 'day' WHERE last_seizure_on IS NOT NULL"
    )
    op.create_check_constraint(
        "ck_patient_intake_last_seizure_precision",
        "patient_intake",
        "CASE last_seizure_precision "
        "WHEN 'day' THEN last_seizure_on IS NOT NULL "
        "WHEN 'month' THEN last_seizure_on IS NOT NULL "
        "AND EXTRACT(DAY FROM last_seizure_on) = 1 "
        "WHEN 'year' THEN last_seizure_on IS NOT NULL "
        "AND EXTRACT(DAY FROM last_seizure_on) = 1 "
        "AND EXTRACT(MONTH FROM last_seizure_on) = 1 "
        "ELSE last_seizure_on IS NULL END",
    )


def downgrade() -> None:
    # Откат теряет точность: «март 2026» остаётся датой 01.03.2026, а «не
    # помню» — пустым ответом. Доза не теряется: строка `dose` заполнена всегда.
    op.drop_constraint("ck_patient_intake_last_seizure_precision", "patient_intake", type_="check")
    op.drop_column("patient_intake", "last_seizure_precision")
    op.drop_constraint("ck_medications_dose_quantity", "medications", type_="check")
    op.drop_column("medications", "dose_unit")
    op.drop_column("medications", "dose_value")
    bind = op.get_bind()
    postgresql.ENUM(*PRECISIONS, name="last_seizure_precision").drop(bind)
    postgresql.ENUM(*DOSE_UNITS, name="medication_dose_unit").drop(bind)
