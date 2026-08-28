"""`/dictionaries` — чтение справочников `seizure_types` и `ketone_methods`.

Раздел 4.2 ТЗ: справочники "наполняются миграцией-сидом; правятся админом".
Правятся — админом, а читаются всеми: без списка типов приступов семья не может
записать приступ (раздел 7.3), а врач видит в дневнике идентификатор вместо
названия. Клинических данных в справочниках нет — это названия и порядок, —
поэтому ограничения по пациенту здесь неуместны.

Запись осталась в `/admin`: расширять доступ к чтению и к правке одним и тем же
роутером нельзя, иначе новая ручка изменения молча унаследовала бы открытый
доступ.
"""

from __future__ import annotations

from fastapi import APIRouter

from core.models import KetoneMethodDict, SeizureType
from core.repositories import dictionaries as dictionaries_repo

from ..deps.auth import CurrentUserDep, SessionDep
from ..deps.query import PaginationDep
from ..schemas import Page
from ..schemas_admin import DictionaryEntryRead

router = APIRouter(prefix="/dictionaries", tags=["dictionaries"])


@router.get(
    "/seizure-types",
    response_model=Page[DictionaryEntryRead],
    summary="Типы приступов",
)
async def list_seizure_types(
    session: SessionDep,
    _: CurrentUserDep,
    page: PaginationDep,
) -> Page[DictionaryEntryRead]:
    items, total = await dictionaries_repo.list_entries(
        session, SeizureType, limit=page.limit, offset=page.offset
    )
    return Page(items=[DictionaryEntryRead.model_validate(e) for e in items], total=total)


@router.get(
    "/ketone-methods",
    response_model=Page[DictionaryEntryRead],
    summary="Методы измерения кетонов",
)
async def list_ketone_methods(
    session: SessionDep,
    _: CurrentUserDep,
    page: PaginationDep,
) -> Page[DictionaryEntryRead]:
    items, total = await dictionaries_repo.list_entries(
        session, KetoneMethodDict, limit=page.limit, offset=page.offset
    )
    return Page(items=[DictionaryEntryRead.model_validate(e) for e in items], total=total)
