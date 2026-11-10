"""`/patients/{patient_id}/menus` — меню дня (раздел 5.3 ТЗ).

День сохраняется целиком (PUT — upsert по дате), итоги дня считает расчётное
ядро и они хранятся вместе с `engine_version` (раздел 4.1 ТЗ). Отметка «съедено»
меняет только флаг позиции: итоги описывают план дня, а не факт съеденного.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Path, Query, Request

from core.clock import local_today
from core.models import Menu, MenuItem
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import menus as menus_repo
from core.repositories import products as products_repo

from ..client_address import client_address
from ..deps.auth import CurrentUser, PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas import ProductRead
from ..schemas_menus import (
    MenuItemEatenWrite,
    MenuItemRead,
    MenuItemWrite,
    MenuRead,
    MenuWeekCopyRead,
    MenuWeekCopySkip,
    MenuWeekCopyWrite,
    MenuWeekDay,
    MenuWeekRead,
    MenuWrite,
)
from ..services import menus as menus_service

router = APIRouter(prefix="/patients/{patient_id}/menus", tags=["menus"])

PatientIdPath = Annotated[uuid.UUID, Path()]

#: Кто составляет день за семью (ADR-0047). Сохранение специалистом — повод
#: сказать семье: план, по которому кормят ребёнка, поменял другой человек.
SPECIALIST_ROLES = frozenset({UserRole.DOCTOR, UserRole.DIETITIAN})


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


async def _save_day(
    session: SessionDep,
    *,
    patient_id: uuid.UUID,
    day: date,
    write_items: Sequence[MenuItemWrite],
    user: CurrentUser,
) -> tuple[Menu, list[MenuItem], bool]:
    """Write one day whole. Returns the day, its items and whether the plan changed.

    The one write path of a day: a single save and a copied week obey the same
    rules, including the refusal to erase what was marked as eaten.
    """

    # Порядок важен. Снимок собирается ДО записи — там же проверяется план
    # (рецепт опубликован, своё блюдо принадлежит пациенту, продукты есть), и
    # отказ означает, что день не сохранится вовсе. Итоги считаются ПОСЛЕ
    # замены позиций: у переиспользованной позиции снимок остаётся прежним, и
    # до `replace_items` неизвестно, какие позиции переиспользованы.
    snapshots = await menus_service.build_snapshots(
        session, patient_id=patient_id, items=list(write_items)
    )
    menu = await menus_repo.upsert(
        session,
        patient_id=patient_id,
        menu_date=day,
        created_by=user.id,
        updated_by=user.id,
    )
    specs = [
        menus_service.to_spec(item, snapshot)
        for item, snapshot in zip(write_items, snapshots, strict=True)
    ]

    # Отметка «съедено» — запись о том, что ребёнок ел, а не часть плана
    # (ADR-0041). Сохранение дня целиком, без позиции, которую уже отметили,
    # стёрло бы её молча — а день теперь составляет и специалист, не видящий,
    # что семья успела съесть с утра (ADR-0047). Отказ — тот же, что у удаления
    # дня: сначала снимается отметка.
    #
    # Позиции читаются ПОСЛЕ `upsert`: он держит строку дня под блокировкой до
    # коммита, а отметка «съедено» берёт ту же блокировку (`lock_menu`). Поэтому
    # отметка, поставленная в ту же секунду, либо уже видна здесь (и даёт 409),
    # либо ждёт этого сохранения и затем видит, что позиции больше нет (Н10).
    stored = await menus_repo.list_items(session, menu_id=menu.id)
    # Снимок до замены: `replace_items` правит сохранённые позиции на месте.
    plan_before = _plan_of(stored)
    lost = menus_repo.eaten_left_out(stored, specs)
    if lost:
        raise ApiError(
            ErrorCode.CONFLICT,
            "В новом плане нет блюда, которое уже отмечено съеденным, — это запись о том, "
            "что ребёнок ел. Оставьте его в плане или сначала снимите отметку.",
            details={"reason": "drops_eaten_items", "eaten": len(lost)},
        )

    items = await menus_repo.replace_items(
        session, menu=menu, patient_id=patient_id, items=specs, created_by=user.id
    )
    totals, engine_version = menus_service.totals_from_items(items)
    menu = await menus_repo.set_totals(
        session, menu=menu, totals=totals, engine_version=engine_version
    )
    return menu, items, plan_before != _plan_of(items)


@router.put("", response_model=MenuRead, summary="Сохранить меню дня")
async def upsert_menu(
    patient_id: PatientIdPath,
    payload: MenuWrite,
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> MenuRead:
    """Итоги дня пересчитываются при каждом сохранении: иначе после правки состава
    в меню остались бы показатели прежнего плана, и семья готовила бы один набор
    блюд, глядя на цифры другого."""

    menu, items, plan_changed = await _save_day(
        session,
        patient_id=patient_id,
        day=payload.date,
        write_items=payload.items,
        user=user,
    )

    # Сообщение — только если план действительно поменялся: повторное
    # сохранение того же дня слало бы семье одно и то же снова и снова.
    if user.role in SPECIALIST_ROLES and plan_changed:
        await menus_service.tell_family_about_plan(
            session,
            menu=menu,
            composer_id=user.id,
            items=len(items),
            ip=client_address(request),
        )
    return await menus_service.to_read(session, menu, items)


DAYS_IN_WEEK = 7


@router.get("/week", response_model=MenuWeekRead, summary="Меню на семь дней")
async def get_week(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
    start: Annotated[date, Query(description="Первый день, YYYY-MM-DD")],
) -> MenuWeekRead:
    days: list[MenuWeekDay] = []
    for offset in range(DAYS_IN_WEEK):
        day = start + timedelta(days=offset)
        menu = await menus_repo.get_by_date(session, patient_id=patient_id, menu_date=day)
        days.append(
            MenuWeekDay(date=day, menu=None if menu is None else await _read(session, menu))
        )
    return MenuWeekRead(start=start, days=days)


@router.post("/week/copy", response_model=MenuWeekCopyRead, summary="Повторить неделю")
async def copy_week(
    patient_id: PatientIdPath,
    payload: MenuWeekCopyWrite,
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> MenuWeekCopyRead:
    """Fills only empty days, each through the ordinary write path of a day.

    Overwriting a planned day could erase what the family has already marked
    as eaten, so replacing is not offered at all, the same as for one day.
    """

    if payload.source_start == payload.target_start:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Неделя не копируется сама в себя.")

    copied: list[date] = []
    skipped: list[MenuWeekCopySkip] = []
    for offset in range(DAYS_IN_WEEK):
        source_day = payload.source_start + timedelta(days=offset)
        target_day = payload.target_start + timedelta(days=offset)

        target = await menus_repo.get_by_date(session, patient_id=patient_id, menu_date=target_day)
        if target is not None and await menus_repo.list_items(session, menu_id=target.id):
            skipped.append(MenuWeekCopySkip(date=target_day, reason="target_not_empty"))
            continue

        source = await menus_repo.get_by_date(session, patient_id=patient_id, menu_date=source_day)
        source_items = (
            [] if source is None else await menus_repo.list_items(session, menu_id=source.id)
        )
        if not source_items:
            skipped.append(MenuWeekCopySkip(date=target_day, reason="source_empty"))
            continue

        write_items = [
            MenuItemWrite(
                meal_index=item.meal_index,
                recipe_id=item.recipe_id,
                custom_dish_id=item.custom_dish_id,
                portion_factor=float(item.portion_factor),
            )
            for item in source_items
        ]
        try:
            # A savepoint per day: a dish that has since been removed costs that
            # day, not the rest of the week.
            async with session.begin_nested():
                menu, items, _changed = await _save_day(
                    session,
                    patient_id=patient_id,
                    day=target_day,
                    write_items=write_items,
                    user=user,
                )
        except ApiError as exc:
            skipped.append(
                MenuWeekCopySkip(date=target_day, reason="not_available", message=exc.message)
            )
            continue

        if user.role in SPECIALIST_ROLES:
            await menus_service.tell_family_about_plan(
                session,
                menu=menu,
                composer_id=user.id,
                items=len(items),
                ip=client_address(request),
                # One message per copy: a week must not arrive as seven.
                notify=not copied,
            )
        copied.append(target_day)

    return MenuWeekCopyRead(copied=copied, skipped=skipped)


@router.delete("", status_code=204, summary="Убрать план на день")
async def delete_menu(
    patient_id: PatientIdPath,
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
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

    # Под блокировкой строки дня: отметка «съедено», поставленная между проверкой
    # ниже и удалением, иначе ушла бы вместе с днём мимо отказа (Н10).
    menu = await menus_repo.get_by_date(
        session, patient_id=patient_id, menu_date=menu_date, lock=True
    )
    if menu is None:
        # Идемпотентно: «дня нет» — это ровно то состояние, которого добивались.
        return

    # Отметка «съедено» — уже не план, а запись о том, что ребёнок ел, и по ней
    # врач судит о выполнении (ADR-0041). Правило жило только на экране Mini
    # App; удаление дня стирало отметки одним нажатием из любого канала
    # (аудит блокеров, 05.10.2026).
    items = await menus_repo.list_items(session, menu_id=menu.id)
    eaten = sum(1 for item in items if item.eaten)
    if eaten:
        raise ApiError(
            ErrorCode.CONFLICT,
            "В этом дне уже есть отметки «съедено» — это запись о том, что ребёнок ел. "
            "Если день составлен по ошибке, сначала снимите отметки.",
            details={"reason": "has_eaten_items", "eaten": eaten},
        )

    await menus_repo.soft_delete(session, menu=menu)
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="menu_day_removed",
        entity="menus",
        entity_id=menu.id,
        ip=client_address(request),
        before={
            "patient_id": str(patient_id),
            "date": menu_date.isoformat(),
            "items": len(items),
        },
    )


def _plan_of(items: Sequence[MenuItem]) -> list[tuple[int, str, str, float]]:
    """Состав дня без отметок и идентификаторов — то, что видит семья у плиты."""

    return sorted(
        (
            item.meal_index,
            str(item.recipe_id or ""),
            str(item.custom_dish_id or ""),
            float(item.portion_factor),
        )
        for item in items
    )


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
    user: PatientAccessDep,
) -> MenuItemRead:
    # Отметка — запись семьи о том, что ребёнок ел (ADR-0047). Специалист
    # составляет план, но не свидетельствует за семью; экран кабинета флажок
    # ему не показывает, а запрет держит сервер (правило 5 CLAUDE.md).
    if user.role in SPECIALIST_ROLES:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Отметку «съедено» ставит семья: это её запись о том, что ребёнок ел.",
        )
    item = await _owned_item(session, item_id, patient_id)

    # Отметка ждёт сохранения или удаления дня, идущего в эту секунду, и
    # перечитывает позицию после него (Н10). Без этого семья отмечала позицию,
    # которую сохранение специалиста уже решило убрать, и отметка уходила вместе
    # с ней молча — мимо отказа 409, ради которого он и существует.
    menu = await menus_repo.lock_menu(session, menu_id=item.menu_id)
    await session.refresh(item)
    if menu is None or menu.deleted_at is not None or item.deleted_at is not None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "План дня только что изменили, и этого блюда в нём больше нет. "
            "Обновите план и отметьте съеденное заново.",
            details={"reason": "plan_changed"},
        )
    # Будущий день съеденным не отмечается: съесть его нельзя, а отметка
    # ушла бы врачу как факт. Запрет здесь, а не только в интерфейсе — бот и
    # любой клиент ходят в ту же ручку. Снять ошибочную отметку можно всегда.
    if payload.eaten and menu.date > local_today():
        raise ApiError(
            ErrorCode.CONFLICT,
            "Этот день ещё не наступил — отметить блюдо съеденным можно в тот "
            "день, когда ребёнок его ел.",
            details={"reason": "future_day"},
        )
    updated = await menus_repo.set_eaten(session, item=item, eaten=payload.eaten)
    return MenuItemRead.model_validate(updated)
