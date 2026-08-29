"""provisional dictionaries from international standards

Шкалы анкеты регистрации и справочник препаратов, засеянные миграцией
086d4c5d6d03 «как прислал заказчик», приведены к международным стандартам.
Значения остаются **provisional**: медицинская команда подтверждает или правит
их админ-ручкой, без новой миграции. Каждое изменение ниже названо источником —
вопросы 19-21 в docs/medical/OPEN_QUESTIONS.md.

Что и почему меняется:

1. **Частота приступов.** Формулировки заказчика сохранены полностью — их
   выбрала его клиника. Добавлено ровно то, чего в шкале не было и что
   обязательно встретится: «реже раза в 3 месяца», «приступов нет» (это цель
   кетотерапии, и выразить её было нечем) и «оценить не удаётся». Последние два
   — из меры качества AAN «Seizure Type, Frequency, and Time Since Last
   Seizure» (Seizure Freedom и Frequency not well defined).

2. **Длительность приступа.** Разрыв 5-10 минут закрыт, границы совмещены с
   операциональным определением эпилептического статуса ILAE (Trinka et al.,
   Epilepsia 2015;56:1515-1523, Table 1): для тонико-клонического приступа
   t1 = 5 мин (момент, когда приступ считается затянувшимся и нужна помощь),
   t2 = 30 мин (после чего возможны отдалённые последствия). Порог 10 минут —
   t1 фокального приступа с нарушением сознания оттуда же.
   Граница 1 минуты **не из стандарта**: она из варианта заказчика «до 1 мин» и
   из формулировки Epilepsy Foundation «большинство приступов заканчиваются
   сами за 1-3 минуты». Так и записано, чтобы её не приняли за клинический
   порог.

3. **Число сменённых препаратов.** Варианты «2 препарата», «более 2х», «более
   5» пересекались (сменивший шесть подходил под два сразу), а нулевой и
   однопрепаратный случаи не помещались никуда. Шкала разбита на
   непересекающиеся 0 / 1 / 2 / 3-5 / 6 и более. Граница «два» сохраняет
   клинический смысл: неэффективность двух подходящих схем и есть определение
   фармакорезистентной эпилепсии (Kwan et al., Epilepsia 2010;51:1069-1077).

4. **Справочник препаратов.** Строки заказчика смешивали действующее вещество с
   торговыми названиями, а «Карбамазепин, Окскарбазепин, Трилептал, Тегретол» —
   два разных вещества в одной строке. Теперь по строке на МНН, торговые
   названия — в синонимах, поиск идёт и по ним. Добавлены препараты, которых в
   списке не было, но которые применяются у детей с фармакорезистентной
   эпилепсией: бриварацетам, руфинамид, стирипентол, каннабидиол, фенфлурамин,
   эверолимус, ганаксолон, фелбамат, ацетазоламид, АКТГ. Гормоны разделены на
   преднизолон и дексаметазон.
   «Летирам» и «Ланистор» из списка заказчика — **реальные зарегистрированные
   препараты** (леветирацетам и ламотриджин), а не опечатки; оставлены
   синонимами. Комбинированные средства с фенобарбиталом (Корвалол, Валокордин,
   Паглюферал) в синонимы **не внесены**: родитель, выбравший «Корвалол»,
   оказался бы записан как принимающий противоэпилептический препарат.

5. **Типы приступов.** Добавлен «Фокальный с переходом в билатеральный
   тонико-клонический» — тип 1.3 действующей классификации ILAE 2025
   (Beniczky, Trinka et al., Epilepsia 2025, doi 10.1111/epi.18338); в дневнике
   KETO-STEP это код FG, и его в справочнике не было.
   Код «C — приступ с падением» из того же дневника **отдельным типом не
   заводится**: по инструкции ILAE 2017 (Fisher et al., Epilepsia
   2017;58:531-542, Table 3) «drop attack» — семиологическое описание, которое
   раскладывается на атонический и тонический приступы, а они в справочнике уже
   есть.

Старые значения **не удаляются, а выводятся из употребления** (`retired`): на них
ссылаются уже заполненные анкеты, и ответ семьи не должен исчезать вместе со
сменой формулировки (правило 4 CLAUDE.md). Новым ответам такой вариант не
предлагается, но остаётся читаемым в старых.

Revision ID: bce695d76e00
Revises: 901f9beb69ae
Create Date: 2026-08-29 23:30:00.000000

"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bce695d76e00"
down_revision: str | None = "901f9beb69ae"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


INTAKE_SCALE = sa.Enum(
    "onset_age",
    "seizure_frequency",
    "seizure_duration",
    "aed_switch_count",
    "meals_per_day",
    name="intake_scale",
    create_type=False,
)

# (шкала, код, подпись, порядок)
ADDED_OPTIONS: list[tuple[str, str, str, int]] = [
    ("seizure_frequency", "freq_rarer", "Реже раза в 3 месяца", 10),
    ("seizure_frequency", "freq_none", "Приступов нет", 11),
    ("seizure_frequency", "freq_unknown", "Оценить не удаётся", 12),
    ("seizure_duration", "dur_1_5min", "От 1 до 5 минут", 21),
    ("seizure_duration", "dur_5_10min", "От 5 до 10 минут", 22),
    ("seizure_duration", "dur_10_30min", "От 10 до 30 минут", 23),
    ("seizure_duration", "dur_over_30min", "30 минут и дольше", 24),
    ("seizure_duration", "dur_unknown", "Не знаю, не засекали", 25),
    ("aed_switch_count", "aed_0", "Ни одного", 30),
    ("aed_switch_count", "aed_1", "1 препарат", 31),
    ("aed_switch_count", "aed_3_5", "3-5 препаратов", 33),
    ("aed_switch_count", "aed_6_plus", "6 и более препаратов", 34),
    ("aed_switch_count", "aed_unknown", "Не знаю", 35),
]

# Переформулированные варианты: код прежний, подпись точнее.
RENAMED_OPTIONS: list[tuple[str, str, str, int]] = [
    ("seizure_duration", "dur_under_1min", "Меньше 1 минуты", 20),
    ("aed_switch_count", "aed_2", "2 препарата", 32),
]

# Варианты с разрывами и пересечениями: выводятся из употребления.
RETIRED_OPTIONS: list[tuple[str, str]] = [
    ("seizure_duration", "dur_under_5min"),
    ("seizure_duration", "dur_from_10min"),
    ("aed_switch_count", "aed_over_2"),
    ("aed_switch_count", "aed_over_5"),
]

# (МНН, синонимы для поиска)
AED_DRUGS: list[tuple[str, list[str]]] = [
    ("Вальпроевая кислота", ["Депакин", "Конвулекс", "Конвульсофин", "Энкорат", "Вальпарин"]),
    ("Леветирацетам", ["Кеппра", "Леветирам", "Летирам", "Леветинол", "Эпитерра"]),
    ("Ламотриджин", ["Ламиктал", "Ламитор", "Ланистор", "Ламолеп", "Конвульсан", "Сейзар"]),
    ("Карбамазепин", ["Финлепсин", "Тегретол", "Зептол", "Карбалепсин"]),
    ("Окскарбазепин", ["Трилептал"]),
    ("Лакосамид", ["Вимпат"]),
    ("Топирамат", ["Топамакс", "Топирамид", "Топсавер", "Макситопир", "Эпимакс"]),
    ("Зонисамид", ["Зонегран"]),
    ("Вигабатрин", ["Сабрил", "Инфира"]),
    ("Этосуксимид", ["Суксилеп", "Суксимид", "Петнидан", "Заронтин"]),
    ("Клобазам", ["Фризиум", "Урбанил"]),
    ("Клоназепам", ["Ривотрил", "Клонотрил"]),
    ("Перампанел", ["Файкомпа"]),
    ("Фенитоин", ["Дифенин", "Дилантин"]),
    ("Фенобарбитал", ["Люминал"]),
    ("Бриварацетам", ["Бривиак"]),
    ("Руфинамид", ["Иновелон"]),
    ("Стирипентол", ["Диакомит"]),
    ("Каннабидиол", ["Эпидиолекс", "Epidyolex"]),
    ("Фенфлурамин", ["Финтепла", "Fintepla"]),
    ("Эверолимус", ["Вотубия", "Афинитор"]),
    ("Ганаксолон", ["Ztalmy"]),
    ("Фелбамат", ["Felbatol"]),
    ("Ацетазоламид", ["Диакарб"]),
    ("Преднизолон", ["Преднизолон"]),
    ("Дексаметазон", ["Дексаметазон"]),
    ("Тетракозактид (АКТГ)", ["Синактен", "АКТГ", "кортикотропин"]),
    ("Другое (указать)", ["другое"]),
    ("Не принимает противоэпилептические препараты", ["не принимает"]),
    ("Не знаю названия", ["не знаю"]),
]

intake_options = sa.table(
    "intake_options",
    sa.column("scale", INTAKE_SCALE),
    sa.column("code", sa.String),
    sa.column("name_ru", sa.String),
    sa.column("sort", sa.Integer),
)


def upgrade() -> None:
    op.add_column(
        "intake_options",
        sa.Column("retired", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "aed_drugs",
        sa.Column("retired", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.bulk_insert(
        intake_options,
        [
            {"scale": scale, "code": code, "name_ru": name, "sort": sort}
            for scale, code, name, sort in ADDED_OPTIONS
        ],
    )

    for scale, code, name, sort in RENAMED_OPTIONS:
        op.execute(
            sa.text(
                "UPDATE intake_options SET name_ru = :name, sort = :sort "
                "WHERE scale = CAST(:scale AS intake_scale) AND code = :code"
            ).bindparams(name=name, sort=sort, scale=scale, code=code)
        )

    for scale, code in RETIRED_OPTIONS:
        op.execute(
            sa.text(
                "UPDATE intake_options SET retired = true "
                "WHERE scale = CAST(:scale AS intake_scale) AND code = :code"
            ).bindparams(scale=scale, code=code)
        )

    # Справочник препаратов пересобирается: строки заказчика смешивали вещество
    # с торговыми названиями. Прежние строки выводятся из употребления, а не
    # удаляются: на них ссылаются заполненные анкеты (идентификатор внутри
    # JSONB-массива), и потерять ответ семьи из-за смены формулировки нельзя.
    op.execute("UPDATE aed_drugs SET retired = true")

    # Вставка по одному, а не bulk_insert: четыре строки заказчика («Лакосамид»,
    # «Клоназепам», «Фенобарбитал», «Стирипентол») названы ровно так же, как МНН,
    # и слепая вставка либо падала бы на уникальном индексе, либо оставляла эти
    # четыре препарата выведенными из употребления — то есть недоступными для
    # выбора. Совпавшая строка не дублируется, а возвращается в строй с новыми
    # синонимами.
    for index, (name, synonyms) in enumerate(AED_DRUGS):
        op.execute(
            sa.text(
                "INSERT INTO aed_drugs (name_ru, synonyms, sort, retired) "
                "VALUES (:name, CAST(:synonyms AS jsonb), :sort, false) "
                "ON CONFLICT (name_ru) DO UPDATE SET "
                "synonyms = EXCLUDED.synonyms, sort = EXCLUDED.sort, retired = false"
            ).bindparams(name=name, synonyms=json.dumps(synonyms, ensure_ascii=False), sort=index)
        )

    # Тип 1.3 действующей классификации ILAE 2025; в дневнике KETO-STEP — код FG.
    op.execute(
        """
        INSERT INTO seizure_types (name_ru, code, sort)
        SELECT 'Фокальный с переходом в билатеральный тонико-клонический', 'FG', 9
        WHERE NOT EXISTS (SELECT 1 FROM seizure_types WHERE code = 'FG')
        """
    )


def downgrade() -> None:
    codes = ", ".join(f"'{code}'" for _, code, _, _ in ADDED_OPTIONS)
    op.execute(f"DELETE FROM intake_options WHERE code IN ({codes})")
    op.execute(f"DELETE FROM aed_drugs WHERE name_ru IN ({_added_drug_names()})")
    op.execute("DELETE FROM seizure_types WHERE code = 'FG'")
    op.drop_column("aed_drugs", "retired")
    op.drop_column("intake_options", "retired")


def _added_drug_names() -> str:
    return ", ".join("'" + name.replace("'", "''") + "'" for name, _ in AED_DRUGS)
