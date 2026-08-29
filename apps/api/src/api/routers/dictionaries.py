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

from typing import Annotated

from fastapi import APIRouter, Query

from core.models import KetoneMethodDict, SeizureType
from core.models.enums import IntakeScale
from core.repositories import dictionaries as dictionaries_repo
from core.repositories import intake as intake_repo

from ..deps.auth import CurrentUserDep, SessionDep
from ..deps.query import PaginationDep
from ..schemas import Page
from ..schemas_admin import DictionaryEntryRead, SeizureTypeRead
from ..schemas_intake import AedDrugRead, IntakeOptionRead

router = APIRouter(prefix="/dictionaries", tags=["dictionaries"])


@router.get(
    "/seizure-types",
    response_model=Page[SeizureTypeRead],
    summary="Типы приступов",
)
async def list_seizure_types(
    session: SessionDep,
    _: CurrentUserDep,
    page: PaginationDep,
) -> Page[SeizureTypeRead]:
    """Отдаётся вместе с коротким кодом: месячная сетка дневника приступов
    подписывает столбцы «TC», а не «Тонико-клонический» (ADR-0007)."""

    items, total = await dictionaries_repo.list_entries(
        session, SeizureType, limit=page.limit, offset=page.offset
    )
    return Page(items=[SeizureTypeRead.model_validate(e) for e in items], total=total)


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


@router.get(
    "/intake-options",
    response_model=Page[IntakeOptionRead],
    summary="Варианты ответов анкеты регистрации",
)
async def list_intake_options(
    session: SessionDep,
    _: CurrentUserDep,
    scale: Annotated[IntakeScale | None, Query(description="Одна шкала вместо всех")] = None,
) -> Page[IntakeOptionRead]:
    """Без пагинации: вариантов у всех пяти шкал меньше двадцати, а анкете
    нужны сразу все — постраничная выдача заставила бы экран собирать шкалу
    из кусков."""

    options = await intake_repo.list_options(session, scale=scale)
    return Page(
        items=[IntakeOptionRead.model_validate(option) for option in options],
        total=len(options),
    )


@router.get(
    "/aed-drugs",
    response_model=Page[AedDrugRead],
    summary="Противоэпилептические препараты",
)
async def list_aed_drugs(
    session: SessionDep,
    _: CurrentUserDep,
    page: PaginationDep,
) -> Page[AedDrugRead]:
    items, total = await intake_repo.list_drugs(session, limit=page.limit, offset=page.offset)
    return Page(items=[AedDrugRead.model_validate(drug) for drug in items], total=total)
