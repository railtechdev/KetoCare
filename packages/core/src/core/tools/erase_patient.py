"""Физическое удаление всех данных пациента по запросу (раздел 11 ТЗ).

    python -m core.tools.erase_patient <patient_id> [--yes]

Правило 4 запрещает физически удалять клинические данные — но у него есть ровно
одно исключение, и это оно: человек вправе потребовать стереть данные ребёнка, и
«мягко удалённая» запись такую просьбу не выполняет.

Порядок обязателен и именно такой:

1. **Архив.** Раздел 11 ТЗ требует экспорта до удаления: восстановить стёртое
   иначе нечем, а ошибка в идентификаторе — это чужая история болезни.
2. **Файлы.** Байты вложений лежат на диске, а не в базе, и dump их не вернёт.
3. **Строки.** В порядке, обратном зависимостям, иначе внешние ключи не дадут.
4. **Журнал.** Сама операция записывается (раздел 11), а нагрузка прежних
   записей об этом пациенте очищается: `before`/`after` содержат назначения и
   замеры, то есть те самые данные, которые велено стереть. Строки остаются —
   они след того, кто и когда действовал.

Список таблиц не перечисляется руками, а выводится из метаданных: таблица с
колонкой `patient_id` и всё, что ссылается на неё, — иначе новая таблица молча
выпала бы из удаления, и «стёрли» означало бы «стёрли не всё».
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_sessionmaker
from ..models import Attachment, AuditLog, Base, Patient
from ..models.enums import AttachmentOwnerKind

#: Таблицы, которые к пациенту не относятся, даже если ссылаются на удаляемое.
#: `audit_log` обрабатывается отдельно: он не удаляется, а очищается.
_KEEP = frozenset({"audit_log"})


def patient_scoped_tables() -> list[str]:
    """Имена таблиц с данными пациента — в порядке, безопасном для удаления.

    Сначала те, у кого есть `patient_id`, затем всё, что ссылается на них
    (например, `menu_items` → `menus`), и так до неподвижной точки. Порядок —
    обратный порядку создания: дети раньше родителей.
    """

    scoped = {
        table.name
        for table in Base.metadata.sorted_tables
        if "patient_id" in table.columns and table.name not in _KEEP
    }
    # Вложения привязаны к пациенту полиморфной парой `owner_kind`+`owner_id`
    # без внешнего ключа, поэтому общее правило их не видит (см. `_rows_of_patient`).
    scoped.add("attachments")

    changed = True
    while changed:
        changed = False
        for table in Base.metadata.sorted_tables:
            if table.name in scoped or table.name in _KEEP:
                continue
            for fk in table.foreign_keys:
                if fk.column.table.name in scoped:
                    scoped.add(table.name)
                    changed = True
                    break

    ordered = [t.name for t in Base.metadata.sorted_tables if t.name in scoped]
    return list(reversed(ordered))


def _rows_of_patient(table: Any, patient_id: uuid.UUID, scoped_ids: set[uuid.UUID]) -> Any:
    """Условие «строки этого пациента» для одной таблицы.

    Одно на сбор и на удаление: два разных означали бы «собрали одно, удалили
    другое». Прямая связь — колонка `patient_id`; косвенная — ссылка на уже
    собранную запись (например, `menu_items` → `menus`).
    """

    if "patient_id" in table.columns:
        return table.c.patient_id == patient_id

    # Вложения — единственный случай, который по метаданным не вывести:
    # владелец полиморфный (`recipe` или `patient`), и внешнего ключа у
    # `owner_id` быть не может. Без этой ветки документы пациента пережили бы
    # его удаление — то есть «стёрли» означало бы «стёрли не всё».
    if table.name == "attachments":
        return (table.c.owner_kind == AttachmentOwnerKind.PATIENT.value) & (
            table.c.owner_id == patient_id
        )

    links = [
        table.c[fk.parent.name].in_(scoped_ids)
        for fk in table.foreign_keys
        if fk.column.table.name != "users"
    ]
    if not links:
        return None

    condition = links[0]
    for extra in links[1:]:
        condition = condition | extra
    return condition


async def _collect(session: AsyncSession, patient_id: uuid.UUID) -> dict[str, list[dict[str, Any]]]:
    """Читает всё, что будет удалено. Это и архив, и источник идентификаторов
    для очистки журнала."""

    archive: dict[str, list[dict[str, Any]]] = {}
    tables = {t.name: t for t in Base.metadata.sorted_tables}

    # Своя таблица пациента — отдельно: в ней `id`, а не `patient_id`.
    patient = await session.get(Patient, patient_id)
    archive["patients"] = (
        [{c.name: _plain(getattr(patient, c.name)) for c in tables["patients"].columns}]
        if patient is not None
        else []
    )

    scoped_ids: set[uuid.UUID] = {patient_id}

    for name in reversed(patient_scoped_tables()):
        table = tables[name]
        condition = _rows_of_patient(table, patient_id, scoped_ids)
        if condition is None:
            continue

        rows = (await session.execute(select(table).where(condition))).mappings().all()
        archive[name] = [{k: _plain(v) for k, v in row.items()} for row in rows]
        # У таблицы может не быть `id` (например, `link_codes` с ключом по
        # коду) — тогда на неё просто никто не ссылается по идентификатору.
        scoped_ids.update(row["id"] for row in rows if isinstance(row.get("id"), uuid.UUID))

    return archive


def _plain(value: Any) -> Any:
    """JSON не умеет uuid, даты и Decimal — а архив должен читаться глазами."""

    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (dict, list, str, int, float, bool)) or value is None:
        return value
    return str(value)


def _write_archive(path: Path, archive: dict[str, list[dict[str, Any]]]) -> None:
    """Синхронно: обращения к диску не должны идти из цикла событий."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(archive, ensure_ascii=False, indent=2), encoding="utf-8")


def _remove_files(stored_names: list[str]) -> int:
    """Стирает байты вложений. Имя проверяется на выход за пределы каталога —
    то же правило, что при раздаче (`services/attachments.py`)."""

    base = Path(get_settings().attachments_dir).resolve()
    removed = 0
    for name in stored_names:
        target = (base / name).resolve()
        if target.is_relative_to(base) and target.exists():
            target.unlink()
            removed += 1
    return removed


async def erase(patient_id: uuid.UUID, *, archive_dir: Path) -> Path:
    """Стирает данные пациента. Возвращает путь к архиву."""

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        patient = await session.get(Patient, patient_id)
        if patient is None:
            raise SystemExit(f"Пациент {patient_id} не найден — ничего не удалено.")

        name = patient.full_name
        archive = await _collect(session, patient_id)

        # Архив пишется ДО удаления и до записи в журнал: если запись на диск
        # не удалась, данные остаются на месте.
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        path = archive_dir / f"erase-{patient_id}-{stamp}.json"
        await asyncio.to_thread(_write_archive, path, archive)

        # Файлы вложений: их байты лежат на диске, и dump их не вернёт.
        attachments = list(
            await session.scalars(
                select(Attachment).where(
                    Attachment.owner_kind == AttachmentOwnerKind.PATIENT,
                    Attachment.owner_id == patient_id,
                )
            )
        )
        removed_files = await asyncio.to_thread(_remove_files, [a.stored_name for a in attachments])

        deleted_ids = {
            uuid.UUID(row["id"])
            for rows in archive.values()
            for row in rows
            if isinstance(row.get("id"), str)
        }

        tables = {t.name: t for t in Base.metadata.sorted_tables}
        removed_rows = 0
        for table_name in patient_scoped_tables():
            table = tables[table_name]
            # Тем же условием, что и сбор: удалять по `id` нельзя — он есть не
            # у всех таблиц (`link_codes` ключуется кодом).
            condition = _rows_of_patient(table, patient_id, deleted_ids)
            if condition is None:
                continue
            result = await session.execute(delete(table).where(condition))
            # `rowcount` есть у CursorResult, но статически execute объявлен
            # как Result — считаем через getattr, а не приводим тип вслепую.
            removed_rows += int(getattr(result, "rowcount", 0) or 0)

        await session.execute(delete(Patient).where(Patient.id == patient_id))

        # Журнал: строки остаются как след действий, нагрузка очищается — в
        # `before`/`after` лежат назначения и замеры, то есть ровно то, что
        # велено стереть.
        await session.execute(
            update(AuditLog)
            .where(AuditLog.entity_id.in_(deleted_ids))
            .values(before=None, after=None)
        )

        session.add(
            AuditLog(
                user_id=None,
                action="erase_patient",
                entity="patients",
                entity_id=patient_id,
                after={
                    "archive": path.name,
                    "rows": removed_rows,
                    "files": removed_files,
                },
            )
        )
        await session.commit()

    print(f"Удалён пациент {name} ({patient_id}).")
    print(f"Строк: {removed_rows}, файлов: {removed_files}.")
    print(f"Архив: {path}")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m core.tools.erase_patient",
        description="Физическое удаление всех данных пациента по запросу (раздел 11 ТЗ).",
    )
    parser.add_argument("patient_id", help="Идентификатор пациента")
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Не спрашивать подтверждения (для скриптов)",
    )
    parser.add_argument(
        "--archive-dir",
        default=None,
        help="Куда положить архив перед удалением (по умолчанию ERASED_DIR)",
    )
    args = parser.parse_args(argv)

    try:
        patient_id = uuid.UUID(args.patient_id)
    except ValueError:
        parser.error("Идентификатор пациента — это UUID")

    if not args.yes:
        # Ошибка в идентификаторе — это чужая история болезни, и вернуть её
        # можно только из архива вручную.
        try:
            answer = input(f"Стереть ВСЕ данные пациента {patient_id}? Отменить нельзя. [y/N] ")
        except EOFError:
            # Запуск из скрипта или по пайпу: спросить некого. Молчание — это
            # «нет», а не «да»; трейсбек здесь читался бы как сбой команды.
            print("\nНечем подтвердить (нет ввода). Запустите с --yes осознанно.")
            return 1
        if answer.strip().lower() not in {"y", "yes", "д", "да"}:
            print("Отменено.")
            return 1

    # Умолчание — из настроек, а не строкой здесь: на сервере это том, и
    # каталог внутри контейнера потерял бы архив при первом деплое.
    archive_dir = Path(args.archive_dir or get_settings().erased_dir)
    asyncio.run(erase(patient_id, archive_dir=archive_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
