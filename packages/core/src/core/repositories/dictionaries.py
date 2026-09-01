"""Справочники `seizure_types` и `ketone_methods` (раздел 4.2 ТЗ).

Раздел 4.2: "наполняются миграцией-сидом; правятся админом" — то есть первичный
список приходит миграцией, а дальнейшие правки идут через API, а не через новые
миграции.

Обе таблицы имеют одинаковую форму (id, name_ru, sort), поэтому функции
параметризованы моделью. TypeVar ограничен ровно двумя моделями: подставить сюда
клиническую таблицу нельзя — у неё другой набор полей и другие правила удаления.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import KetoneMethodDict, SeizureLog, SeizureType


async def get[T: (SeizureType, KetoneMethodDict)](
    session: AsyncSession, model: type[T], entry_id: uuid.UUID
) -> T | None:
    return await session.get(model, entry_id)


async def list_entries[T: (SeizureType, KetoneMethodDict)](
    session: AsyncSession, model: type[T], *, limit: int = 50, offset: int = 0
) -> tuple[list[T], int]:
    """Порядок — по `sort`, затем по названию: `sort` задаёт администратор и
    дубликаты в нём допустимы, а порядок значений в справочнике должен быть
    устойчивым между запросами."""

    stmt = select(model).order_by(model.sort, model.name_ru).limit(limit).offset(offset)
    items = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(model))
    return items, int(total or 0)


async def create[T: (SeizureType, KetoneMethodDict)](
    session: AsyncSession, model: type[T], *, name_ru: str, sort: int, code: str | None = None
) -> T:
    """Код есть только у типов приступов: у методов измерения кетонов его нет и
    быть не должно, и передавать его туда — значит заводить колонку, которой в
    таблице не существует."""

    entry = model(name_ru=name_ru, sort=sort)
    if code is not None and hasattr(entry, "code"):
        entry.code = code
    session.add(entry)
    await session.flush()
    return entry


async def update[T: (SeizureType, KetoneMethodDict)](
    session: AsyncSession,
    *,
    entry: T,
    name_ru: str,
    sort: int,
    code: str | None = None,
    code_set: bool = False,
) -> T:
    """`code_set` отделяет «код не трогали» от «код очистили».

    Без этого различия очистка кода была бы неотличима от правки одного
    названия, и вернуть тип в состояние «кода нет» стало бы нечем.
    """

    entry.name_ru = name_ru
    entry.sort = sort
    if code_set and hasattr(entry, "code"):
        entry.code = code
    await session.flush()
    return entry


async def delete[T: (SeizureType, KetoneMethodDict)](session: AsyncSession, *, entry: T) -> None:
    """Физическое удаление.

    Справочник — не клиническая и не дневниковая запись, колонки `deleted_at` у
    этих таблиц нет (раздел 4.2 ТЗ), поэтому мягкое удаление здесь неприменимо.
    Безопасность обеспечивает `count_references`: значение, на которое ссылаются
    записи, до удаления не доходит.
    """

    await session.delete(entry)
    await session.flush()


async def count_references[T: (SeizureType, KetoneMethodDict)](
    session: AsyncSession, model: type[T], entry_id: uuid.UUID
) -> int:
    """Сколько записей ссылается на значение справочника.

    Мягко удалённые дневниковые записи считаются наравне с остальными: строка
    остаётся в БД (правило 4 CLAUDE.md), её по-прежнему видно в истории и в
    отчётах, и без названия типа приступа она осиротеет.

    На `ketone_methods` не ссылается ни одна таблица: в `ketone_logs` метод —
    enum-поле (`blood` | `urine`) по разделу 4.2 ТЗ, а не внешний ключ.
    """

    if not issubclass(model, SeizureType):
        return 0

    total = await session.scalar(
        select(func.count()).select_from(SeizureLog).where(SeizureLog.seizure_type_id == entry_id)
    )
    return int(total or 0)
