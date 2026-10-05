"""ilae 2025 seizure types, therapy end, control visits

Три ответа клиники от 09.09.2026, которые были помечены закрытыми, но в продукте
отсутствовали (ADR-0050):

- **вопрос 4** — «принимаем классификацию ILAE 2025 целиком». Справочник типов
  приступов заполняется узлами таксономии из таблицы 1 официального русского
  перевода (Beniczky et al., Epilepsia 2025; перевод на сайте ILAE). Названия и
  сокращения — дословно из перевода, включая латинские «A», «TA», «AA», «MA» у
  абсансов: так они напечатаны в переводе. «Другие генерализованные приступы»
  (3.3) не заводится — перевод прямо называет его группирующим термином, а не
  категорией приступов. Сокращение «ГМТКП» у 3.2.1 взято из текста перевода (в
  таблице его нет); у 3.2.2 и у «неклассифицированного» сокращения нет нигде, и
  код остаётся пустым — пустое честнее выдуманного.

  Прежние типы НЕ удаляются и НЕ переписываются в новые: на них ссылаются
  записи дневника, а соответствие «тонико-клонический → ГТКП или НПБТК» — это
  суждение о начале приступа, которое за врача не сделать. Они помечаются
  `retired`: новый приступ ими не записать, прежние записи показываются как
  были;
- **вопрос 18** — завершение терапии: дата, причина, пояснение в медицинском
  профиле;
- **вопросы 17 и 34** — контрольные визиты (`control_visits`).

Revision ID: 4fdbbc0c4e38
Revises: b1c8a71a9a72
Create Date: 2026-10-05 14:38:58.973203

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "4fdbbc0c4e38"
down_revision: str | None = "b1c8a71a9a72"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

THERAPY_END_REASON = postgresql.ENUM(
    "course_completed",
    "ineffective",
    "adverse_effects",
    "family_decision",
    "transferred",
    "other",
    name="therapy_end_reason",
)

# (номер узла ILAE 2025, название, сокращение) — таблица 1 русского перевода.
ILAE_2025: list[tuple[str, str, str | None]] = [
    ("1", "Фокальный приступ", "ФП"),
    ("1.1", "Фокальный приступ с сохранением сознания", "ФПСС"),
    ("1.2", "Фокальный приступ с нарушением сознания", "ФПНС"),
    ("1.3", "Фокальный приступ с переходом в билатеральный тонико-клонический", "ФППБТК"),
    ("2", "Неуточненный (фокальный или генерализованный) приступ", "НП"),
    ("2.1", "Неуточненный (фокальный или генерализованный) приступ с сохранением сознания", "НПСС"),
    ("2.2", "Неуточненный (фокальный или генерализованный) приступ с нарушением сознания", "НПНС"),
    (
        "2.3",
        "Неуточненный (фокальный или генерализованный) приступ с переходом "
        "в билатеральный тонико-клонический",
        "НПБТК",
    ),
    ("3", "Генерализованный приступ", "ГП"),
    ("3.1", "Абсанс", "A"),
    ("3.1.1", "Типичный абсанс", "TA"),
    ("3.1.2", "Атипичный абсанс", "AA"),
    ("3.1.3", "Миоклонический абсанс", "MA"),
    ("3.1.4", "Миоклония век с абсансом или без", "МВА"),
    ("3.2", "Генерализованный тонико-клонический приступ", "ГТКП"),
    ("3.2.1", "Миоклонико-тонико-клонический приступ", "ГМТКП"),
    ("3.2.2", "Абсанс с переходом в тонико-клонический приступ", None),
    ("3.3.1", "Генерализованный миоклонический приступ", "ГМП"),
    ("3.3.2", "Генерализованный клонический приступ", "ГКП"),
    ("3.3.3", "Генерализованный негативный миоклонус", "ГНМ"),
    ("3.3.4", "Генерализованный эпилептический спазм", "ГЭС"),
    ("3.3.5", "Генерализованный тонический приступ", "ГТП"),
    ("3.3.6", "Генерализованный атонический приступ", "ГАП"),
    ("3.3.7", "Генерализованный миоклонико-атонический приступ", "ГМАП"),
    ("4", "Неклассифицированный приступ", None),
]

seizure_types = sa.table(
    "seizure_types",
    sa.column("name_ru", sa.String),
    sa.column("code", sa.String),
    sa.column("sort", sa.Integer),
    sa.column("ilae_ref", sa.String),
    sa.column("retired", sa.Boolean),
)


def upgrade() -> None:
    op.create_table(
        "control_visits",
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("planned_on", sa.Date(), nullable=False),
        sa.Column("month_offset", sa.Integer(), nullable=True),
        sa.Column("completed_on", sa.Date(), nullable=True),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint(
            "month_offset IS NULL OR month_offset > 0", name="control_visit_month_positive"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_control_visits_patient_id"), "control_visits", ["patient_id"], unique=False
    )
    op.create_index(
        "uq_control_visits_patient_month",
        "control_visits",
        ["patient_id", "month_offset"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND month_offset IS NOT NULL"),
    )

    THERAPY_END_REASON.create(op.get_bind(), checkfirst=False)
    op.add_column("medical_profiles", sa.Column("therapy_ended_on", sa.Date(), nullable=True))
    op.add_column(
        "medical_profiles",
        sa.Column(
            "therapy_end_reason",
            postgresql.ENUM(name="therapy_end_reason", create_type=False),
            nullable=True,
        ),
    )
    op.add_column("medical_profiles", sa.Column("therapy_end_note", sa.String(), nullable=True))
    op.create_check_constraint(
        "therapy_end_has_reason",
        "medical_profiles",
        "(therapy_ended_on IS NULL) = (therapy_end_reason IS NULL)",
    )

    op.add_column("seizure_types", sa.Column("ilae_ref", sa.String(length=8), nullable=True))
    op.add_column(
        "seizure_types",
        sa.Column("retired", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.alter_column(
        "seizure_types",
        "code",
        existing_type=sa.VARCHAR(length=4),
        type_=sa.String(length=8),
        existing_nullable=True,
    )

    # Всё, что было в справочнике до перехода, — вне ILAE 2025: выводится из
    # употребления, но остаётся (на него ссылается дневник).
    op.execute(seizure_types.update().values(retired=True))
    op.bulk_insert(
        seizure_types,
        [
            {"name_ru": name, "code": code, "sort": index, "ilae_ref": ref, "retired": False}
            for index, (ref, name, code) in enumerate(ILAE_2025)
        ],
    )


def downgrade() -> None:
    # Новые типы удаляются, только если на них ещё никто не сослался: запись
    # дневника, сделанная после перехода, удаляться откатом схемы не должна.
    # Ссылающиеся строки остаются. Если хоть одна из них с кодом длиннее
    # четырёх знаков («ФППБТК»), откат упадёт на сужении колонки `code` —
    # это правильный отказ, а не потеря данных.
    op.execute(
        "DELETE FROM seizure_types WHERE ilae_ref IS NOT NULL AND NOT EXISTS "
        "(SELECT 1 FROM seizure_logs WHERE seizure_logs.seizure_type_id = seizure_types.id)"
    )
    op.execute(seizure_types.update().values(retired=False))
    op.alter_column(
        "seizure_types",
        "code",
        existing_type=sa.String(length=8),
        type_=sa.VARCHAR(length=4),
        existing_nullable=True,
    )
    op.drop_column("seizure_types", "retired")
    op.drop_column("seizure_types", "ilae_ref")
    op.drop_constraint("therapy_end_has_reason", "medical_profiles", type_="check")
    op.drop_column("medical_profiles", "therapy_end_note")
    op.drop_column("medical_profiles", "therapy_end_reason")
    op.drop_column("medical_profiles", "therapy_ended_on")
    THERAPY_END_REASON.drop(op.get_bind(), checkfirst=False)
    op.drop_index(
        "uq_control_visits_patient_month",
        table_name="control_visits",
        postgresql_where=sa.text("deleted_at IS NULL AND month_offset IS NOT NULL"),
    )
    op.drop_index(op.f("ix_control_visits_patient_id"), table_name="control_visits")
    op.drop_table("control_visits")
