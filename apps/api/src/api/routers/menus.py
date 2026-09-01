"""`/patients/{patient_id}/menus` — меню дня (раздел 5.3 ТЗ).

День сохраняется целиком (PUT — upsert по дате), итоги дня считает расчётное
ядро и они хранятся вместе с `engine_version` (раздел 4.1 ТЗ). Отметка «съедено»
меняет только флаг позиции: итоги описывают план дня, а не факт съеденного.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Path, Query

from core.models import Menu, MenuItem
from core.repositories import menus as menus_repo
from core.repositories import products as products_repo

from ..deps.auth import PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas import ProductRead
from ..schemas_menus import MenuItemEatenWrite, MenuItemRead, MenuRead, MenuWrite
from ..services import menus as menus_service

router = APIRouter(prefix="/patients/{patient_id}/menus", tags=["menus"])

PatientIdPath = Annotated[uuid.UUID, Path()]


async def _read(session: SessionDep, menu: Menu) -> MenuRead:
    items = await menus_repo.list_items(session, menu_id=menu.id)
    return await menus_service.to_read(session, menu, items)


async def _owned_item(session: SessionDep, item_id: uuid.UUID, patient_id: uuid.UUID) -> MenuItem:
    """Позиция меню, принадлежащая именно этому пациенту.

    Проверка отдельно от `require_patient_access`: доступ к пациенту не даёт прав
    на запись, привязанную к другому. Несовпадение отдаём как 404, а не 403 —
    иначе по коду ответа можно узнать, что такая позиция существует у кого-то ещё.
    """

    item = await menus_repo.get_item(session, item_id)
    if item is None or item.patient_id != patient_id:
        raise ApiError(ErrorCode.NOT_FOUND, "Позиция меню не найдена.")
    return item


@router.get("", response_model=MenuRead, summary="Меню на дату")
async def get_menu(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
    menu_date: Annotated[date, Query(alias="date", description="Дата меню, YYYY-MM-DD")],
) -> MenuRead:
    menu = await menus_repo.get_by_date(session, patient_id=patient_id, menu_date=menu_date)
    if menu is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Меню на эту дату не составлено.")
    return await _read(session, menu)


#: Сколько недавних продуктов показывать до ввода.
#:
#: Список подсказки, а не справочник: длиннее десятка он перестаёт помогать —
#: в нём приходится искать так же, как в поиске.
RECENT_PRODUCTS_LIMIT = 10


@router.get(
    "/recent-products",
    response_model=list[ProductRead],
    summary="Продукты, которые семья уже использовала",
)
async def recent_products(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
) -> list[ProductRead]:
    """Подсказка для выбора продукта ДО ввода (правило П11 канона).

    Поле подбора молчало, пока не набраны два символа, — то есть на пустом поле
    не помогало ничем, хотя семья изо дня в день кладёт в меню одни и те же
    двадцать продуктов.

    Источник — снимки уже составленных дней: это ровно то, что семья
    действительно использовала, а не то, что популярно вообще.
    """

    ids = await menus_repo.recent_product_ids(session, patient_id=patient_id)
    if not ids:
        return []

    products = await products_repo.get_by_ids(session, product_ids=ids)

    # Порядок сохраняется (от свежих к старым), выведенные из оборота
    # отбрасываются: поиск их тоже не предлагает, и подсказка не должна
    # возвращать в оборот то, что из него вывели.
    return [
        ProductRead.model_validate(products[pid])
        for pid in ids
        if pid in products and products[pid].is_active
    ][:RECENT_PRODUCTS_LIMIT]


@router.put("", response_model=MenuRead, summary="Сохранить меню дня")
async def upsert_menu(
    patient_id: PatientIdPath,
    payload: MenuWrite,
    session: SessionDep,
    user: PatientAccessDep,
) -> MenuRead:
    """Итоги дня пересчитываются при каждом сохранении: иначе после правки состава
    в меню остались бы показатели прежнего плана, и семья готовила бы один набор
    блюд, глядя на цифры другого."""

    # Порядок важен. Снимок собирается ДО записи — там же проверяется план
    # (рецепт опубликован, своё блюдо принадлежит пациенту, продукты есть), и
    # отказ означает, что день не сохранится вовсе. Итоги считаются ПОСЛЕ
    # замены позиций: у переиспользованной позиции снимок остаётся прежним, и
    # до `replace_items` неизвестно, какие позиции переиспользованы.
    snapshots = await menus_service.build_snapshots(
        session, patient_id=patient_id, items=payload.items
    )
    menu = await menus_repo.upsert(
        session,
        patient_id=patient_id,
        menu_date=payload.date,
        created_by=user.id,
    )
    items = await menus_repo.replace_items(
        session,
        menu=menu,
        patient_id=patient_id,
        items=[
            menus_service.to_spec(item, snapshot)
            for item, snapshot in zip(payload.items, snapshots, strict=True)
        ],
        created_by=user.id,
    )
    totals, engine_version = menus_service.totals_from_items(items)
    menu = await menus_repo.set_totals(
        session, menu=menu, totals=totals, engine_version=engine_version
    )
    return await menus_service.to_read(session, menu, items)


@router.delete("", status_code=204, summary="Убрать план на день")
async def delete_menu(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
    menu_date: Annotated[date, Query(alias="date", description="Дата меню, YYYY-MM-DD")],
) -> None:
    """Возвращает день в состояние «не спланирован» (ADR-0018).

    Ручки не было, и ошибочный день оставался навсегда: удаление последней
    позиции заблокировано (сервер не принимает пустой день), а другого выхода
    не существовало. Такой день попадал в «Ближайший приём» на главной, в итоги
    и в отчёт — то есть искажал картину выполнения плана, которую смотрит врач.

    Удаление мягкое: на позиции ссылаются записи дневника еды, и по отметкам
    «съедено» судят о выполнении. День при этом можно составить заново — при
    сохранении `deleted_at` сбрасывается.
    """

    menu = await menus_repo.get_by_date(session, patient_id=patient_id, menu_date=menu_date)
    if menu is None:
        # Идемпотентно: «дня нет» — это ровно то состояние, которого добивались.
        return

    await menus_repo.soft_delete(session, menu=menu)


@router.post(
    "/items/{item_id}/eaten",
    response_model=MenuItemRead,
    summary="Отметить позицию меню съеденной",
)
async def mark_item_eaten(
    patient_id: PatientIdPath,
    item_id: Annotated[uuid.UUID, Path()],
    payload: MenuItemEatenWrite,
    session: SessionDep,
    _: PatientAccessDep,
) -> MenuItemRead:
    item = await _owned_item(session, item_id, patient_id)
    updated = await menus_repo.set_eaten(session, item=item, eaten=payload.eaten)
    return MenuItemRead.model_validate(updated)
