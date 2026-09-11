"""Фильтр журнала аудита в кабинете знает каждое действие и сущность, которые пишет API.

Потребитель — раздел «Журнал аудита» у администратора
(`apps/web/src/features/admin/auditFilters.ts`, списки `AUDIT_ACTIONS` и
`AUDIT_ENTITIES`). Стык проверяется на стороне поставщика (CLAUDE.md): списки
фильтра вели руками, и к 11.09.2026 они не знали пяти действий
(`erase_patient`, `login_miniapp`, `merge`, `password_reset`, `unpublish`) и
трёх сущностей — такие строки показывались в журнале, но отобрать их фильтром
было нельзя.

Значения собираются из исходников: литералы `action="…"` и `entity="…"` в API,
ядре и воркере. Справочники пишут сущность через `model.__tablename__`, поэтому
их таблицы добавлены явно. Проверка в обе стороны: фильтр не знает записанного
— и фильтр предлагает то, чего никто не пишет.
"""

from __future__ import annotations

import re
from pathlib import Path

from api.services.admin import create_dictionary_entry

REPO = Path(__file__).resolve().parents[3]
SOURCES = (
    REPO / "apps/api/src",
    REPO / "packages/core/src",
    REPO / "apps/worker/src",
    # Серверные команды тоже пишут в журнал: `create_admin.py` — `reset_password`.
    REPO / "infra/scripts",
)
FILTERS = REPO / "apps/web/src/features/admin/auditFilters.ts"

#: `action=` у `argparse.add_argument` — не действие журнала.
_ARGPARSE_ACTIONS = frozenset({"store_true", "store_false", "store_const", "append", "count"})


def _dictionary_entities() -> frozenset[str]:
    """Справочники: сущность журнала — имя таблицы модели (`services/admin.py`).

    Модели берутся из ограничений параметра типа, а не перечисляются здесь:
    новый справочник попадёт в проверку сам. Если параметр типа убрали или
    заменили на `bound`, проверка сломалась бы молча — отсюда явный отказ.
    """

    params = getattr(create_dictionary_entry, "__type_params__", ())
    constraints = params[0].__constraints__ if params else ()
    assert constraints, (
        "create_dictionary_entry больше не перечисляет модели справочников "
        "ограничением типа — поправьте сбор сущностей справочников в этом тесте"
    )
    return frozenset(model.__tablename__ for model in constraints)


def _written(kind: str) -> set[str]:
    # Точка в имени бывает («ai_summary.approve»), пробелы вокруг `=` — тоже
    # (`action = "reset_password"` в серверной команде).
    pattern = re.compile(rf'\b{kind}\s*=\s*"([a-z_.]+)"')
    found: set[str] = set()
    for root in SOURCES:
        for path in root.rglob("*.py"):
            found.update(pattern.findall(path.read_text(encoding="utf-8")))
    return found


def _filter_list(name: str) -> set[str]:
    source = FILTERS.read_text(encoding="utf-8")
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", source, re.S)
    assert match is not None, f"список {name} не найден в {FILTERS}"
    return set(re.findall(r'"([a-z_.]+)"', match.group(1)))


def test_filter_knows_every_written_action() -> None:
    written = _written("action") - _ARGPARSE_ACTIONS
    listed = _filter_list("AUDIT_ACTIONS")

    assert written - listed == set(), "API пишет действия, которых нет в фильтре журнала"
    assert listed - written == set(), "фильтр журнала предлагает действия, которых никто не пишет"


def test_filter_knows_every_written_entity() -> None:
    written = _written("entity") | _dictionary_entities()
    listed = _filter_list("AUDIT_ENTITIES")

    assert written - listed == set(), "API пишет сущности, которых нет в фильтре журнала"
    assert listed - written == set(), "фильтр журнала предлагает сущности, которых никто не пишет"
