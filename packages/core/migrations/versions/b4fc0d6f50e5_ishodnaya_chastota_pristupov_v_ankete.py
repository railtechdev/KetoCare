"""исходная частота приступов в анкете

Revision ID: b4fc0d6f50e5
Revises: 75efa2e76e41
Create Date: 2026-09-10 18:58:25.628262

Ответ клиники от 09.09.2026 (вопрос 19): «Исходная частота перед началом
кетогенной диеты фиксируется отдельно и в дальнейшем не перезаписывается».

Эффект кетотерапии измеряют снижением ОТНОСИТЕЛЬНО исходного уровня (>50 % —
ответ, >90 % — почти полный контроль). Пока частота лежала одним полем и
переписывалась при каждой правке анкеты, сравнивать было не с чем: через полгода
в карте оставалась только сегодняшняя частота.

**Заполнение уже собранных анкет.** Для анкеты, которую с момента заведения ни
разу не правили, сохранённая частота И ЕСТЬ исходная: её назвали при
регистрации, до начала диеты. Такие строки заполняются.

Анкеты, которые правили (`updated_at <> created_at`), остаются пустыми, и это
намеренно: правка могла быть уже после начала терапии, и подставить туда
сегодняшнюю частоту значило бы записать сегодняшнее число как вчерашнее —
ровно та подмена, ради устранения которой поле и заводится. Пустое значит
«исходный уровень неизвестен», и это честнее выдуманного.

`func.now()` в PostgreSQL — время начала транзакции, одинаковое для всех строк
вставки, поэтому у нетронутой анкеты метки совпадают побайтово, а не примерно.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4fc0d6f50e5"
down_revision: str | None = "75efa2e76e41"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FK_NAME = "patient_intake_baseline_seizure_frequency_id_fkey"


def upgrade() -> None:
    op.add_column(
        "patient_intake",
        sa.Column("baseline_seizure_frequency_id", sa.UUID(), nullable=True),
    )
    # Имя ограничения задано явно: с `None` его нельзя снять в `downgrade`.
    op.create_foreign_key(
        _FK_NAME,
        "patient_intake",
        "intake_options",
        ["baseline_seizure_frequency_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(
        sa.text(
            "UPDATE patient_intake "
            "SET baseline_seizure_frequency_id = seizure_frequency_id "
            "WHERE seizure_frequency_id IS NOT NULL AND updated_at = created_at"
        )
    )


def downgrade() -> None:
    op.drop_constraint(_FK_NAME, "patient_intake", type_="foreignkey")
    op.drop_column("patient_intake", "baseline_seizure_frequency_id")
