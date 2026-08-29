"""patient intake questionnaire and seizure type codes

Анкета регистрации пациента и коды типов приступов из материалов заказчика от
29.08.2026 (`docs/client/`). Что из присланного принято и почему — ADR-0007.

Три таблицы:

- `intake_options` — варианты ответов пяти шкал анкеты (возраст первого
  приступа, частота и длительность приступов, число сменённых ПЭП, кратность
  приёмов пищи). Один справочник на все шкалы: устроены одинаково, правятся
  одним экраном админки.
- `aed_drugs` — противоэпилептические препараты. Каноническое имя и синонимы
  вместо свободной строки: «Летирам», «Леветирацетам» и «Кеппра» — одно и то же
  вещество, и свободный ввод сделал бы записи несравнимыми.
- `patient_intake` — ответы **семьи**, по строке на пациента. Отдельно от
  `medical_profiles`, который пишет только врач: разделение по таблицам
  выражает право записи связью, а не проверкой в каждой ручке (правило 5).

Значения справочников — **provisional**, ровно те, что прислал заказчик, вплоть
до формулировок. Применять их как есть нельзя: в трёх шкалах из пяти варианты
не покрывают всю область значений либо пересекаются (частоте приступов некуда
записать их прекращение; длительность не покрывает интервал 5-10 минут; «более
2х» и «более 5 препаратов» пересекаются). Вопросы 19-21 в
`docs/medical/OPEN_QUESTIONS.md`; правки — админ-ручкой, без новой миграции.

Коды типов приступов проставляются только шести типам, совпадающим с дневником
KETO-STEP однозначно. «Атонический», «Клонический» и «Инфантильные спазмы»
остаются без кода, а типов «приступ с падением» (C) и «фокальный с вторичной
генерализацией» (FG) миграция не добавляет: соответствие — медицинское решение,
вопрос 4 там же.

Revision ID: 086d4c5d6d03
Revises: 16c703b6408c
Create Date: 2026-08-29 22:12:20.246852

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "086d4c5d6d03"
down_revision: str | None = "16c703b6408c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INTAKE_SCALE = sa.Enum(
    "onset_age",
    "seizure_frequency",
    "seizure_duration",
    "aed_switch_count",
    "meals_per_day",
    name="intake_scale",
)

# Формулировки — из документа заказчика без правок (TODO(med): вопросы 19-21).
# Код — машинный и стабильный: по нему собирается статистика, и переформулировка
# варианта не должна её обнулять.
INTAKE_OPTIONS: list[tuple[str, str, str]] = [
    ("onset_age", "onset_0_6m", "0-6 мес"),
    ("onset_age", "onset_6_12m", "6-12 мес"),
    ("onset_age", "onset_12_24m", "12-24 мес"),
    ("onset_age", "onset_24_36m", "24-36 мес"),
    ("onset_age", "onset_after_36m", "После 36 мес"),
    ("seizure_frequency", "freq_daily", "Ежедневно"),
    ("seizure_frequency", "freq_weekly", "Пару раз в неделю"),
    ("seizure_frequency", "freq_2_3_weeks", "Раз в 2-3 недели"),
    ("seizure_frequency", "freq_2_3_months", "Раз в 2-3 месяца"),
    ("seizure_duration", "dur_under_1min", "До 1 мин"),
    ("seizure_duration", "dur_under_5min", "До 5 мин"),
    ("seizure_duration", "dur_from_10min", "10 мин и больше"),
    ("aed_switch_count", "aed_2", "2 препарата"),
    ("aed_switch_count", "aed_over_2", "Более 2 препаратов"),
    ("aed_switch_count", "aed_over_5", "Более 5 препаратов"),
    ("meals_per_day", "meals_3", "3 приёма пищи"),
    ("meals_per_day", "meals_5", "5 приёмов пищи"),
    ("meals_per_day", "meals_over_5", "Более 5 приёмов пищи"),
]

# Строки анкеты заказчика как есть: родитель узнаёт препарат по названию на
# упаковке, а не по действующему веществу. Синонимы — те же названия по
# отдельности, чтобы поиск находил по любому из них.
#
# TODO(med): строки смешивают действующее вещество с торговыми названиями, а
# «Карбамазепин, Окскарбазепин» — это два разных вещества в одной строке.
# Разделение и канонические имена — вопрос 21 в OPEN_QUESTIONS.
AED_DRUGS: list[tuple[str, list[str]]] = [
    ("Конвулекс, Депакин", ["Конвулекс", "Депакин", "Вальпроевая кислота", "Вальпроат"]),
    ("Летирам, Леветирацетам, Кеппра", ["Летирам", "Леветирацетам", "Кеппра"]),
    ("Ламитор, Ланистор, Ламиктал", ["Ламитор", "Ланистор", "Ламиктал", "Ламотриджин"]),
    ("Лакосамид", ["Лакосамид", "Вимпат"]),
    (
        "Карбамазепин, Окскарбазепин, Трилептал, Тегретол",
        ["Карбамазепин", "Окскарбазепин", "Трилептал", "Тегретол", "Финлепсин"],
    ),
    ("Сабрил", ["Сабрил", "Вигабатрин"]),
    ("Этосуксимид, Суксимид", ["Этосуксимид", "Суксимид", "Суксилеп"]),
    ("Клобазам, Фризиум", ["Клобазам", "Фризиум"]),
    ("Файкомпа, Перампанел", ["Файкомпа", "Перампанел"]),
    ("Клоназепам", ["Клоназепам"]),
    ("Зонисамид, Зонегран", ["Зонисамид", "Зонегран"]),
    ("Топамакс, Топирамид", ["Топамакс", "Топирамид", "Топирамат"]),
    ("Фенитоин, Дифенин", ["Фенитоин", "Дифенин"]),
    ("Фенобарбитал", ["Фенобарбитал", "Люминал"]),
    ("Стирипентол", ["Стирипентол", "Диакомит"]),
    ("Гормоны: преднизолон, дексаметазон", ["Преднизолон", "Дексаметазон", "Гормоны"]),
]

# Только однозначные соответствия дневнику KETO-STEP (ADR-0007).
SEIZURE_TYPE_CODES: list[tuple[str, str]] = [
    ("Абсанс", "A"),
    ("Фокальный", "F"),
    ("Миоклонический", "M"),
    ("Тонический", "T"),
    ("Тонико-клонический", "TC"),
    ("Другой / неуточнённый", "O"),
]

intake_options = sa.table(
    "intake_options",
    # Тип колонки — сам enum, а не строка: иначе asyncpg отправит VARCHAR, и
    # Postgres откажется приводить его к intake_scale.
    sa.column("scale", INTAKE_SCALE),
    sa.column("code", sa.String),
    sa.column("name_ru", sa.String),
    sa.column("sort", sa.Integer),
)

aed_drugs = sa.table(
    "aed_drugs",
    sa.column("name_ru", sa.String),
    sa.column("synonyms", postgresql.JSONB),
    sa.column("sort", sa.Integer),
)


def upgrade() -> None:
    op.create_table(
        "aed_drugs",
        sa.Column("name_ru", sa.String(length=255), nullable=False),
        sa.Column("synonyms", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name_ru"),
    )
    op.create_table(
        "intake_options",
        sa.Column("scale", INTAKE_SCALE, nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name_ru", sa.String(length=255), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scale", "code", name="uq_intake_options_scale_code"),
    )
    op.create_table(
        "patient_intake",
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("last_seizure_on", sa.Date(), nullable=True),
        sa.Column("onset_age_id", sa.UUID(), nullable=True),
        sa.Column("seizure_frequency_id", sa.UUID(), nullable=True),
        sa.Column("seizure_duration_id", sa.UUID(), nullable=True),
        sa.Column("meals_per_day_id", sa.UUID(), nullable=True),
        sa.Column("developmental_delay", sa.Boolean(), nullable=True),
        sa.Column("meals_regular", sa.Boolean(), nullable=True),
        sa.Column("current_aed_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
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
        sa.ForeignKeyConstraint(["meals_per_day_id"], ["intake_options.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["onset_age_id"], ["intake_options.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["seizure_duration_id"], ["intake_options.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["seizure_frequency_id"], ["intake_options.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("patient_id"),
    )
    op.add_column("medical_profiles", sa.Column("aed_switch_count_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_medical_profiles_aed_switch_count_id",
        "medical_profiles",
        "intake_options",
        ["aed_switch_count_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.add_column("seizure_types", sa.Column("code", sa.String(length=4), nullable=True))

    op.bulk_insert(
        intake_options,
        [
            {"scale": scale, "code": code, "name_ru": name, "sort": index}
            for index, (scale, code, name) in enumerate(INTAKE_OPTIONS)
        ],
    )
    op.bulk_insert(
        aed_drugs,
        [
            {"name_ru": name, "synonyms": synonyms, "sort": index}
            for index, (name, synonyms) in enumerate(AED_DRUGS)
        ],
    )

    # Коды проставляются по названию: справочник засеян миграцией
    # 688c4b9bd8b0, идентификаторов у значений нет. Названия, которых в базе
    # нет (админ переименовал), просто не обновятся — это не ошибка.
    for name, code in SEIZURE_TYPE_CODES:
        op.execute(
            sa.text("UPDATE seizure_types SET code = :code WHERE name_ru = :name").bindparams(
                code=code, name=name
            )
        )


def downgrade() -> None:
    op.drop_column("seizure_types", "code")
    op.drop_constraint(
        "fk_medical_profiles_aed_switch_count_id", "medical_profiles", type_="foreignkey"
    )
    op.drop_column("medical_profiles", "aed_switch_count_id")
    op.drop_table("patient_intake")
    op.drop_table("intake_options")
    op.drop_table("aed_drugs")
    op.execute("DROP TYPE IF EXISTS intake_scale")
