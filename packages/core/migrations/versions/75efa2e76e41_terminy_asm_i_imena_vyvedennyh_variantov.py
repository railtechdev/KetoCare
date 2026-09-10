"""термины ASM и утверждённая формулировка частоты приступов

**Имя файла осталось от первой редакции** и обещает больше, чем здесь есть:
«имена выведенных вариантов» отсюда убраны — чинить было нечего, сид заводит их
правильно, а «коды в именах» оказались дрейфом одной локальной базы.
Переименовать файл может только человек: хук держит каталог миграций. Ревизия от
имени файла не зависит — alembic читает `revision` внутри.

Revision ID: 75efa2e76e41
Revises: 3847f44df7d0
Create Date: 2026-09-10 13:05:00.000000

Две правки текстов справочников по ответам клиники от 09.09.2026. Данные, а не
схема: колонки не меняются.

**1. «Противоэпилептические» → «противоприступные» (ответ 21).** Действующая
международная терминология — antiseizure medications (ASM), и клиника попросила
перейти на неё. Меняется единственная строка справочника, где термин виден
семье: вариант ответа «Не принимает противоэпилептические препараты».

**2. «Пару раз в неделю» → «Несколько раз в неделю» (ответ 19).** Клиника
утвердила шкалу частоты приступов и в утверждённом списке эта формулировка
другая. Разница не косметическая: «пару» читается как ровно два.

Строка шкалы ищется по `code`, препарат — по точному `name_ru`: у `aed_drugs` нет
стабильного бизнес-кода, какой есть у `intake_options` (`uq(scale, code)`), и
других способов её найти не остаётся. Про это же — докстринг `AedDrug.is_drug` и
миграция `3847f44df7d0`. Не нашлось — миграция падает: молча оставить старый
термин хуже, чем остановить выкат.

Падение безопасно: `deploy.sh` гонит миграции до пересоздания приложений, и на
стенде продолжает работать прежняя версия. Что делать дальше — в `docs/DEPLOY.md`,
раздел «Миграция остановилась на справочнике». Заводить новую ревизию БЕСПОЛЕЗНО:
alembic останавливается на упавшей и до следующей не доходит никогда.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "75efa2e76e41"
down_revision: str | None = "3847f44df7d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: `aed_drugs`: было → стало. Ищется по имени: `code` у таблицы нет.
_DRUG_RENAMES = {
    "Не принимает противоэпилептические препараты": "Не принимает противоприступные препараты",
}

#: `intake_options`: (шкала, код) → новое имя.
_OPTION_RENAMES = {
    ("seizure_frequency", "freq_weekly"): "Несколько раз в неделю",
}

#: Обратные имена для отката — ровно то, что было до этой миграции.
#:
#: Проверено прогоном отката на отдельной базе: справочник возвращается в
#: состояние сида. Первая редакция этой миграции ещё «чинила» имена выведенных
#: вариантов `aed_over_2` и `aed_over_5` — но чинить было нечего: сид
#: `086d4c5d6d03` заводит их как «Более 2 препаратов» и «Более 5 препаратов», а
#: коды в именах оказались дрейфом одной локальной базы. Хуже того, обратная
#: карта той редакции ЗАПИСЫВАЛА коды в имена, то есть откат вносил дефект,
#: который миграция объявляла исправленным.
_DRUG_RENAMES_BACK = {new: old for old, new in _DRUG_RENAMES.items()}
_OPTION_RENAMES_BACK = {
    ("seizure_frequency", "freq_weekly"): "Пару раз в неделю",
}


def _rename_drugs(mapping: dict[str, str]) -> None:
    bind = op.get_bind()
    for old, new in mapping.items():
        done = bind.execute(
            sa.text("UPDATE aed_drugs SET name_ru = :new WHERE name_ru = :old RETURNING id"),
            {"old": old, "new": new},
        ).fetchall()
        if not done:
            raise RuntimeError(
                f"В справочнике препаратов не нашлась строка «{old}». Её переименовали "
                "раньше?\n\n"
                "Порядок действий — docs/DEPLOY.md, «Миграция остановилась на "
                "справочнике». Коротко: вернуть прежнее имя в базе и повторить выкат. "
                "Заводить новую ревизию бесполезно — alembic остановился здесь и до "
                "неё не дойдёт."
            )


def _rename_options(mapping: dict[tuple[str, str], str]) -> None:
    bind = op.get_bind()
    for (scale, code), new in mapping.items():
        done = bind.execute(
            sa.text(
                "UPDATE intake_options SET name_ru = :new "
                "WHERE scale = CAST(:scale AS intake_scale) AND code = :code RETURNING id"
            ),
            {"scale": scale, "code": code, "new": new},
        ).fetchall()
        if not done:
            raise RuntimeError(
                f"В шкале «{scale}» не нашёлся вариант «{code}».\n\n"
                "Порядок действий — docs/DEPLOY.md, «Миграция остановилась на "
                "справочнике»."
            )


def upgrade() -> None:
    _rename_drugs(_DRUG_RENAMES)
    _rename_options(_OPTION_RENAMES)


def downgrade() -> None:
    _rename_drugs(_DRUG_RENAMES_BACK)
    _rename_options(_OPTION_RENAMES_BACK)
