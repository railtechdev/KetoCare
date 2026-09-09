"""приём пищи в плане дня — позиция, а не имя

Revision ID: e73d6d812ac8
Revises: faa4184b31a4
Create Date: 2026-09-09 11:16:08.004219

Разбор — ADR-0029. Коротко: число приёмов пищи задаёт назначение (1-10), а план
дня состоял ровно из четырёх именованных приёмов, и шестиприёмное назначение в
нём не раскладывалось вовсе. Клиника считает приёмы, а не называет их — так
спрашивает её собственная анкета регистрации.

**Перенос значений идёт здесь же, а не отдельной data-миграцией.** Разделить
нельзя: колонка `meal_index` объявлена `NOT NULL`, и между «добавили» и
«заполнили» схема была бы невозможной. Правило про отдельные data-миграции — о
сидах справочников, а не о переносе столбца в столбец.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "e73d6d812ac8"
down_revision: str | None = "faa4184b31a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Соответствие «имя приёма → его номер в дне». Порядок тот же, в котором
#: значения были перечислены в типе `meal_slot`: по нему и шла сортировка дня.
_SLOT_TO_INDEX = (
    ("breakfast", 1),
    ("lunch", 2),
    ("dinner", 3),
    ("snack", 4),
)

_MEAL_SLOT_ENUM = postgresql.ENUM(
    "breakfast", "lunch", "dinner", "snack", name="meal_slot", create_type=False
)


def upgrade() -> None:
    op.add_column("menu_items", sa.Column("meal_index", sa.SmallInteger(), nullable=True))

    case = " ".join(f"WHEN '{slot}' THEN {index}" for slot, index in _SLOT_TO_INDEX)
    op.execute(sa.text(f"UPDATE menu_items SET meal_index = CASE meal_slot {case} END"))

    # Ни одной позиции без номера остаться не может: тип `meal_slot` перечисляет
    # ровно эти четыре значения, и NULL в колонке был запрещён. Если строка всё
    # же осталась, `SET NOT NULL` упадёт — это лучше, чем позиция без приёма.
    op.alter_column("menu_items", "meal_index", nullable=False)
    op.create_check_constraint("ck_menu_items_meal_index_positive", "menu_items", "meal_index >= 1")

    op.drop_column("menu_items", "meal_slot")
    # Тип остаётся в базе и после удаления колонки — убираем явно, иначе
    # автогенерация будет всё время видеть «лишний» тип.
    _MEAL_SLOT_ENUM.drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()

    # Приёмы с пятого и дальше именами не выражаются: имён у них нет вовсе.
    # Откат на таких данных — потеря плана, поэтому он отказывает, а не
    # выполняется частично.
    beyond = bind.scalar(
        sa.text("SELECT count(*) FROM menu_items WHERE meal_index > :last"),
        {"last": len(_SLOT_TO_INDEX)},
    )
    if beyond:
        raise RuntimeError(
            f"Откат невозможен: {beyond} позиций плана стоят на приёмах "
            f"после {len(_SLOT_TO_INDEX)}-го, а имени для них не существует. "
            "Сначала перенесите эти позиции в первые четыре приёма."
        )

    _MEAL_SLOT_ENUM.create(bind, checkfirst=True)
    op.add_column("menu_items", sa.Column("meal_slot", _MEAL_SLOT_ENUM, nullable=True))

    case = " ".join(f"WHEN {index} THEN '{slot}'" for slot, index in _SLOT_TO_INDEX)
    op.execute(
        sa.text(f"UPDATE menu_items SET meal_slot = (CASE meal_index {case} END)::meal_slot")
    )

    op.alter_column("menu_items", "meal_slot", nullable=False)
    op.drop_constraint("ck_menu_items_meal_index_positive", "menu_items", type_="check")
    op.drop_column("menu_items", "meal_index")
