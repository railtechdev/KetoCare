"""`/patients/{patient_id}/menus` — меню дня (раздел 5.3 ТЗ).

День сохраняется целиком (PUT — upsert по дате), итоги дня считает расчётное
ядро и они хранятся вместе с `engine_version` (раздел 4.1 ТЗ). Отметка «съедено»
меняет только флаг позиции: итоги описывают план дня, а не факт съеденного.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Body, Path, Query, Request

from core.clock import local_today
from core.models import Menu, MenuItem
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import custom_dishes as custom_dishes_repo
from core.repositories import menus as menus_repo
from core.repositories import products as products_repo
from core.repositories import recipes as recipes_repo

from ..client_address import client_address
from ..deps.auth import CurrentUser, PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas import ProductRead
from ..schemas_menus import (
    DishUsageRead,
    MenuItemEatenWrite,
    MenuItemRead,
    MenuItemRefreshWrite,
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


@router.get(
    "/dish-usage",
    response_model=DishUsageRead,
    summary="Где уже стояли рецепты и блюда ребёнка",
)
async def dish_usage(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
) -> DishUsageRead:
    """«Уже давали»: когда блюдо стояло в меню этого ребёнка и когда его съели.

    Диетолог подбирает рецепты каждому ребёнку и ставит их в неделю; без этого
    приходилось помнить, что из подобранного ребёнок уже пробовал (замечание
    17.11.2026).
    """

    rows = await menus_repo.usage_rows(session, patient_id=patient_id)
    return menus_service.dish_usage(rows)


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

    # Порядок важен. Снимок собирается до замены позиций — там же проверяется
    # план (рецепт опубликован, своё блюдо принадлежит пациенту, продукты
    # есть), и отказ откатывает всю транзакцию вместе с `upsert`: день не
    # сохранится вовсе. Сохранённые позиции нужны снимку — позиция, оставшаяся
    # в плане, держит прежний снимок, даже если её своё блюдо с тех пор удалили.
    # Итоги считаются ПОСЛЕ замены позиций: у переиспользованной позиции снимок
    # остаётся прежним, и до `replace_items` неизвестно, какие переиспользованы.
    menu = await menus_repo.upsert(
        session,
        patient_id=patient_id,
        menu_date=day,
        created_by=user.id,
        updated_by=user.id,
    )

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
    snapshots = await menus_service.build_snapshots(
        session, patient_id=patient_id, items=list(write_items), stored=stored
    )
    specs = [
        menus_service.to_spec(item, snapshot)
        for item, snapshot in zip(write_items, snapshots, strict=True)
    ]
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


def _require_whole_week(start: date) -> None:
    if start > date.max - timedelta(days=DAYS_IN_WEEK):
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Дата вне допустимого диапазона.")


@router.get("/week", response_model=MenuWeekRead, summary="Меню на семь дней")
async def get_week(
    patient_id: PatientIdPath,
    session: SessionDep,
    _: PatientAccessDep,
    start: Annotated[date, Query(description="Первый день, YYYY-MM-DD")],
) -> MenuWeekRead:
    _require_whole_week(start)
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

    _require_whole_week(payload.source_start)
    _require_whole_week(payload.target_start)
    # Overlapping weeks would make a day just filled the source of the next one.
    if abs((payload.source_start - payload.target_start).days) < DAYS_IN_WEEK:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Недели не должны пересекаться.")

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
                # A past day may have been agreed with the doctor and is only
                # marked; a new day must not be planned with what is excluded.
                excluded = (await menus_service.to_read(session, menu, items)).excluded_products
                if excluded:
                    names = ", ".join(product.name_ru for product in excluded)
                    raise ApiError(ErrorCode.CONFLICT, f"Исключено этому ребёнку: {names}.")
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


def _frozen_part(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    """What a family cooks by: name, servings and the weighed composition."""

    if snapshot is None:
        return None
    return {key: snapshot.get(key) for key in ("title", "servings", "ingredients")}


async def _fitted_dish_in_place_of_recipe(
    session: SessionDep, *, item: MenuItem, patient_id: uuid.UUID, dish_id: uuid.UUID
) -> MenuItemWrite:
    """The item as it will stand with the child's dish fitted from its recipe.

    Only where the amount of food is not open to reading: a recipe for one
    serving standing in the day at ×1. A child's dish is one meal — «Сохранить
    и добавить в меню» puts it at ×1 — but the calculator saves whatever is on
    screen: the whole recipe for all its servings if the grams were edited by
    hand, one meal after «Подобрать». The server cannot tell the two apart, and
    a guessed portion would silently feed the child a quarter or four times the
    meal (safety review, 19.11.2026). Any other case is refused with the way
    round: take the recipe out of the day and put the dish in.
    """

    if item.recipe_id is None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "В этом дне стоит блюдо ребёнка, а не рецепт из базы, — заменять нечего. "
            "Возьмите новый состав без замены.",
            details={"reason": "not_a_recipe"},
        )
    dish = await custom_dishes_repo.get(session, dish_id)
    if dish is None or dish.patient_id != patient_id:
        raise ApiError(ErrorCode.NOT_FOUND, "Блюдо не найдено.")
    if dish.source_recipe_id != item.recipe_id:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Это блюдо подобрано не из рецепта, который стоит в дне. Чтобы поставить "
            "другое блюдо, измените день.",
            details={"reason": "other_recipe"},
        )
    recipe = await recipes_repo.get(session, item.recipe_id)
    if recipe is None or recipe.servings != 1 or float(item.portion_factor) != 1:
        raise ApiError(
            ErrorCode.CONFLICT,
            "В дне рецепт стоит не одной порцией, и сколько еды окажется в блюде, "
            "однозначно не сказать. Уберите рецепт из этого приёма и добавьте блюдо "
            "ребёнка, проверив порцию.",
            details={"reason": "portion_ambiguous"},
        )
    return MenuItemWrite(
        meal_index=item.meal_index,
        custom_dish_id=dish.id,
        portion_factor=1.0,
    )


@router.post(
    "/items/{item_id}/refresh",
    response_model=MenuRead,
    summary="Взять в день новый состав блюда",
)
async def refresh_item(
    patient_id: PatientIdPath,
    item_id: Annotated[uuid.UUID, Path()],
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
    payload: Annotated[MenuItemRefreshWrite | None, Body()] = None,
) -> MenuRead:
    """Позиция дня получает состав блюда или рецепта таким, какой он сейчас.

    Позиция хранит снимок состава на день сохранения (ADR-0016), и подогнанные
    после этого граммы в день не попадали: «убрать и добавить заново» —
    единственный путь, и диетолог правила блюдо, не видя, что неделя осталась
    прежней (17.11.2026). Съеденное не обновляется: это уже запись о том, что
    ребёнок ел. Отказ снимка (рецепт снят с публикации, блюдо удалено) — тот
    же, что у сохранения дня.

    С `custom_dish_id` место рецепта из базы занимает блюдо ребёнка, подобранное
    из него (ADR-0091): диетолог открыла рецепт дня в калькуляторе и сохранила
    граммы своим блюдом. Только это блюдо и только вместо его рецепта — заменить
    позицию чем-то другим по-прежнему можно лишь сохранением дня.
    """

    item = await _owned_item(session, item_id, patient_id)
    # Та же блокировка дня, что у сохранения и отметки «съедено» (Н10): отметка,
    # поставленная в эту секунду, либо видна здесь, либо ждёт обновления.
    menu = await menus_repo.lock_menu(session, menu_id=item.menu_id)
    await session.refresh(item)
    if menu is None or menu.deleted_at is not None or item.deleted_at is not None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "План дня только что изменили, и этого блюда в нём больше нет. Обновите план.",
            details={"reason": "plan_changed"},
        )
    if item.eaten:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Блюдо уже отмечено съеденным — это запись о том, что ребёнок ел, и её "
            "состав не меняется.",
            details={"reason": "eaten"},
        )

    source = MenuItemWrite(
        meal_index=item.meal_index,
        recipe_id=item.recipe_id,
        custom_dish_id=item.custom_dish_id,
        portion_factor=float(item.portion_factor),
    )
    dish_id = payload.custom_dish_id if payload is not None else None
    if dish_id is not None and dish_id != item.custom_dish_id:
        source = await _fitted_dish_in_place_of_recipe(
            session, item=item, patient_id=patient_id, dish_id=dish_id
        )
    replaced = source.custom_dish_id != item.custom_dish_id

    (snapshot,) = await menus_service.build_snapshots(
        session, patient_id=patient_id, items=[source]
    )
    # Состав уже тот же — день не трогается: ни «Составил(а)», ни аудита, ни
    # второго сообщения семье (то же правило, что у `PUT` дня, `plan_changed`).
    # Кнопку экран показывает только при расхождении, но держит это сервер.
    if not replaced and _frozen_part(snapshot) == _frozen_part(item.snapshot):
        return await _read(session, menu)

    if replaced:
        await menus_repo.set_source(
            session,
            item=item,
            recipe_id=source.recipe_id,
            custom_dish_id=source.custom_dish_id,
            portion_factor=source.portion_factor,
        )
    await menus_repo.set_snapshot(
        session, menu=menu, item=item, snapshot=snapshot, updated_by=user.id
    )
    items = await menus_repo.list_items(session, menu_id=menu.id)
    totals, engine_version = menus_service.totals_from_items(items)
    menu = await menus_repo.set_totals(
        session, menu=menu, totals=totals, engine_version=engine_version
    )
    if user.role in SPECIALIST_ROLES:
        await menus_service.tell_family_about_plan(
            session,
            menu=menu,
            composer_id=user.id,
            items=len(items),
            ip=client_address(request),
        )
    return await menus_service.to_read(session, menu, items)


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
