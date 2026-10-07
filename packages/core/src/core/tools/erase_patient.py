"""Физическое удаление всех данных пациента по запросу (раздел 11 ТЗ).

    python -m core.tools.erase_patient <patient_id> [--yes]

Правило 4 запрещает физически удалять клинические данные — но у него есть ровно
одно исключение, и это оно: человек вправе потребовать стереть данные ребёнка, и
«мягко удалённая» запись такую просьбу не выполняет.

Порядок обязателен и именно такой:

1. **Архив.** Раздел 11 ТЗ требует экспорта до удаления: восстановить стёртое
   иначе нечем, а ошибка в идентификаторе — это чужая история болезни.
2. **Строки.** В порядке, обратном зависимостям, иначе внешние ключи не дадут.
3. **Журнал.** Сама операция записывается (раздел 11), а нагрузка прежних
   записей об этом пациенте очищается: `before`/`after` содержат назначения и
   замеры, то есть те самые данные, которые велено стереть. Строки остаются —
   они след того, кто и когда действовал.
4. **Коммит, и только потом файлы.** На диске у пациента два вида файлов:
   вложения (`ATTACHMENTS_DIR`) и собранные PDF-отчёты (`REPORTS_DIR`) — в
   отчёте ФИО и клинические данные, а ночная очистка ищет отчёты по строкам
   `report_jobs`, которых после стирания нет. Снимать байты до коммита нельзя:
   сбой между удалением файлов и коммитом откатил бы строки, а документов уже не
   было бы ни на диске, ни в архиве (Н12, SECURITY_REVIEW). Поэтому список
   файлов пишется рядом с архивом до коммита (`*.files.json`), файлы снимаются
   после него, а не снятое остаётся в этом списке — его добивает
   `--retry-files <список>`. Список с пациентом, который ещё есть в базе
   (коммит не случился), повтор не тронет.

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
from ..models import Attachment, AuditLog, Base, Patient, ReportJob
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


def _file_targets(attachments: list[str], reports: list[str]) -> list[str]:
    """Абсолютные пути файлов пациента на диске.

    Имя проверяется на выход за пределы своего каталога — то же правило, что
    при раздаче (`services/attachments.py`, `routers/reports.py`): имя из базы,
    указывающее наружу, не повод стирать чужой файл.
    """

    settings = get_settings()
    targets: list[str] = []
    for base_dir, names in (
        (settings.attachments_dir, attachments),
        (settings.reports_dir, reports),
    ):
        base = Path(base_dir).resolve()
        for name in names:
            target = (base / name).resolve()
            if target.is_relative_to(base) and target != base:
                targets.append(str(target))
    return targets


def _remove_files(targets: list[str]) -> tuple[int, list[str]]:
    """Снимает файлы. Возвращает число снятых и то, что снять не удалось.

    Отсутствующий файл — не ошибка: отчёт мог истечь и уйти с ночной очисткой,
    а повтор (`--retry-files`) встречает уже снятое.
    """

    removed = 0
    failed: list[str] = []
    for raw in targets:
        try:
            Path(raw).unlink()
            removed += 1
        except FileNotFoundError:
            continue
        except OSError as exc:
            print(f"Не удалось удалить {raw}: {exc}", file=sys.stderr)
            failed.append(raw)
    return removed, failed


def _write_pending(path: Path, patient_id: uuid.UUID, targets: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"patient_id": str(patient_id), "files": targets}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


async def _delete_rows(
    session: AsyncSession,
    patient_id: uuid.UUID,
    archive: dict[str, list[dict[str, Any]]],
    *,
    archive_name: str,
    files: int,
    requested_by: str,
) -> int:
    """Удаляет строки пациента и очищает журнал — без коммита."""

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
        update(AuditLog).where(AuditLog.entity_id.in_(deleted_ids)).values(before=None, after=None)
    )

    session.add(
        AuditLog(
            user_id=None,
            action="erase_patient",
            entity="patients",
            entity_id=patient_id,
            after={
                "archive": archive_name,
                "rows": removed_rows,
                # Сколько файлов снимается после коммита; что не снялось,
                # видно по списку `*.files.json` рядом с архивом.
                "files": files,
                # Кто распорядился. Запись без этого фиксировала факт
                # стирания, но не основание: через полгода на вопрос «по
                # чьему запросу» ответа не было бы, а операция необратима.
                # `user_id` остаётся пустым намеренно — команду запускают из
                # консоли сервера, а не из-под учётной записи.
                "requested_by": requested_by or "не указан",
            },
        )
    )
    return removed_rows


async def erase(patient_id: uuid.UUID, *, archive_dir: Path, requested_by: str = "") -> Path:
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

        # Файлы пациента на диске: вложения и собранные PDF-отчёты. Снимаются
        # ПОСЛЕ коммита (Н12), а список пишется до него — иначе сбой между
        # коммитом и снятием оставил бы файлы, о которых никто не знает.
        attachments = list(
            await session.scalars(
                select(Attachment).where(
                    Attachment.owner_kind == AttachmentOwnerKind.PATIENT,
                    Attachment.owner_id == patient_id,
                )
            )
        )
        # У задачи в работе имени файла в строке ещё нет, а воркер пишет
        # `<id задачи>.pdf` до отметки «готово»: такой файл ищется по
        # идентификатору. Воркер, не нашедший строки после записи, снимает файл
        # сам (`worker.reports.task`).
        jobs = (
            await session.execute(
                select(ReportJob.id, ReportJob.file_name).where(ReportJob.patient_id == patient_id)
            )
        ).all()
        reports = sorted(
            {name for job_id, file_name in jobs for name in (file_name, f"{job_id}.pdf") if name}
        )
        targets = _file_targets([a.stored_name for a in attachments], reports)
        pending = path.with_name(f"{path.stem}.files.json")
        await asyncio.to_thread(_write_pending, pending, patient_id, targets)

        try:
            removed_rows = await _delete_rows(
                session,
                patient_id,
                archive,
                archive_name=path.name,
                files=len(targets),
                requested_by=requested_by,
            )
            await session.commit()
        except BaseException:
            # Строки остались — значит, и файлы обязаны остаться, а список,
            # по которому их стёр бы повтор, не нужен.
            await asyncio.to_thread(pending.unlink, missing_ok=True)
            raise

    removed_files, failed = await asyncio.to_thread(_remove_files, targets)
    await asyncio.to_thread(_settle_pending, pending, patient_id, failed)

    print(f"Удалён пациент {name} ({patient_id}).")
    print(f"Строк: {removed_rows}, файлов: {removed_files}.")
    print(f"Архив: {path}")
    if failed:
        print(
            f"Не удалось снять файлов: {len(failed)}. Список — {pending}; повторите:\n"
            f"    python -m core.tools.erase_patient --retry-files {pending}",
            file=sys.stderr,
        )
    return path


def _settle_pending(pending: Path, patient_id: uuid.UUID, failed: list[str]) -> None:
    """Пустой список больше не нужен; непустой — то, что осталось добить."""

    if failed:
        _write_pending(pending, patient_id, failed)
    else:
        pending.unlink(missing_ok=True)


def _within_data_dirs(paths: list[str]) -> list[str]:
    """Повторная проверка границ: список лежит на диске, и путь из него не
    должен уводить за пределы каталогов вложений и отчётов."""

    settings = get_settings()
    bases = [
        Path(settings.attachments_dir).resolve(),
        Path(settings.reports_dir).resolve(),
    ]
    kept: list[str] = []
    for raw in paths:
        target = Path(raw).resolve()
        if any(target.is_relative_to(base) and target != base for base in bases):
            kept.append(raw)
    return kept


async def retry_files(pending: Path) -> list[str]:
    """Добить файлы, не снятые после коммита. Возвращает то, что снова не снялось.

    Список мог остаться и от прерванного запуска, где коммита не было вовсе, —
    тогда пациент на месте, и его файлы трогать нельзя: это не стирание, а
    потеря документов живой карты.
    """

    data = json.loads(await asyncio.to_thread(pending.read_text, encoding="utf-8"))
    patient_id = uuid.UUID(data["patient_id"])
    async with get_sessionmaker()() as session:
        if await session.get(Patient, patient_id) is not None:
            raise SystemExit(
                f"Пациент {patient_id} есть в базе — стирание не завершилось, файлы не тронуты."
            )
    targets = await asyncio.to_thread(_within_data_dirs, list(data["files"]))
    _, failed = await asyncio.to_thread(_remove_files, targets)
    await asyncio.to_thread(_settle_pending, pending, patient_id, failed)
    return failed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m core.tools.erase_patient",
        description="Физическое удаление всех данных пациента по запросу (раздел 11 ТЗ).",
    )
    parser.add_argument("patient_id", nargs="?", help="Идентификатор пациента")
    parser.add_argument(
        "--retry-files",
        default=None,
        help="Добить файлы, не снятые прошлым запуском: путь к списку *.files.json",
    )
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
    parser.add_argument(
        "--requested-by",
        default="",
        help="Кто распорядился стиранием: имя или почта. Уходит в audit_log",
    )
    args = parser.parse_args(argv)

    if args.retry_files:
        failed = asyncio.run(retry_files(Path(args.retry_files)))
        if failed:
            print(f"Снова не удалось снять файлов: {len(failed)}. Список сохранён.")
            return 1
        print("Все файлы сняты.")
        return 0
    if args.patient_id is None:
        parser.error("Нужен идентификатор пациента или --retry-files")

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
    asyncio.run(erase(patient_id, archive_dir=archive_dir, requested_by=args.requested_by))
    return 0


if __name__ == "__main__":
    sys.exit(main())
