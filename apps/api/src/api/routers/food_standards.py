"""`/food-standards` — стандарты питания (ADR-0056, ADR-0057).

Стандарт — набор значений продуктов, по которому специалист собирает меню.
Список читает персонал; заводят и описывают стандарты те же роли, что ведут
справочник продуктов; закрывает стандарт администратор, и это необратимо.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path

from core.models import DEFAULT_FOOD_STANDARD_ID, FoodStandard
from core.models.enums import CarbsConvention, FoodStandardKind, UserRole
from core.repositories import audit as audit_repo
from core.repositories import food_standards as food_standards_repo
from core.repositories import menu_templates as menu_templates_repo
from core.repositories import products as products_repo
from core.repositories import recipes as recipes_repo

from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..schemas import (
    CatalogueMergeField,
    CatalogueMergeRequest,
    CatalogueMergeResult,
    CatalogueMergeRow,
    CatalogueMergeSource,
    CatalogueMergeTotals,
    FoodStandardCreate,
    FoodStandardRead,
    FoodStandardUpdate,
    MenuTemplateDetail,
    MenuTemplateItemRead,
    MenuTemplateRead,
)
from ..services import catalogue_merge

router = APIRouter(prefix="/food-standards", tags=["food-standards"])

#: Кто видит стандарты. Семья работает только с основным и выбора не имеет
#: (ADR-0056): ей список ничего не даёт, а названия внешних документов рядом с
#: кетогенным справочником читались бы как разрешение по ним кормить.
_READER_ROLES = (UserRole.ADMIN, UserRole.DOCTOR, UserRole.DIETITIAN)

#: Кто заводит и описывает стандарты — те же, кто правит продукты
#: (`routers/products._EDITOR_ROLES`, решение 6 плана, ADR-0057).
_EDITOR_ROLES = (UserRole.ADMIN, UserRole.DOCTOR, UserRole.DIETITIAN)


def _read(standard: FoodStandard, products: int) -> FoodStandardRead:
    return FoodStandardRead.model_validate(standard).model_copy(update={"products": products})


async def _standard_or_404(session: SessionDep, standard_id: uuid.UUID) -> FoodStandard:
    standard = await food_standards_repo.get(session, standard_id)
    if standard is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Стандарт питания не найден.")
    return standard


async def _name_is_free(
    session: SessionDep, *, name: str, exclude_id: uuid.UUID | None = None
) -> None:
    existing = await food_standards_repo.find_by_name(session, name=name, exclude_id=exclude_id)
    if existing is not None:
        raise ApiError(
            ErrorCode.CONFLICT,
            f"Стандарт «{existing.name}» уже есть — названия различаются только "
            "регистром или пробелами. Новая редакция документа — отдельный стандарт "
            "со своей версией в названии.",
            details={"standard_id": str(existing.id)},
        )


@router.get(
    "",
    response_model=list[FoodStandardRead],
    summary="Стандарты питания",
    dependencies=[Depends(require_roles(*_READER_ROLES))],
)
async def list_standards(
    session: SessionDep, _: CurrentUserDep, include_inactive: bool = False
) -> list[FoodStandardRead]:
    """Потребитель — кабинет (`features/standards`): отбор справочника по
    стандарту, карточка стандарта, выбор, куда положить копию продукта."""

    standards = await food_standards_repo.list_all(session, include_inactive=include_inactive)
    counts = await food_standards_repo.count_products(session)
    return [_read(standard, counts.get(standard.id, 0)) for standard in standards]


@router.get(
    "/{standard_id}",
    response_model=FoodStandardRead,
    summary="Карточка стандарта",
    dependencies=[Depends(require_roles(*_READER_ROLES))],
)
async def get_standard(
    standard_id: Annotated[uuid.UUID, Path()], session: SessionDep, _: CurrentUserDep
) -> FoodStandardRead:
    standard = await _standard_or_404(session, standard_id)
    counts = await food_standards_repo.count_products(session)
    return _read(standard, counts.get(standard.id, 0))


@router.post(
    "",
    response_model=FoodStandardRead,
    status_code=201,
    summary="Завести стандарт питания",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def create_standard(
    payload: FoodStandardCreate, user: CurrentUserDep, session: SessionDep
) -> FoodStandardRead:
    """Свой стандарт клиники — или внешний документ, который затем наполняется
    импортом и закрывается.

    Новая редакция документа — новый стандарт: прежний остаётся за уже
    собранными блюдами и днями, а переписать его значения было бы правкой
    закрытого стандарта в обход запрета.
    """

    # Ядро считает `carbs_100g` углеводами ВМЕСТЕ с клетчаткой (ADR-0030).
    # Стандарт с раздельной записью при загрузке надо приводить к этому
    # правилу, а такого приведения ещё нет: молча вычесть клетчатку второй раз
    # хуже отказа (ADR-0056, последствия).
    if payload.carbs_convention is CarbsConvention.NET:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Стандарт, где углеводы записаны без клетчатки, пока завести нельзя: "
            "расчёт считает углеводы вместе с клетчаткой, и такие значения нужно "
            "сначала привести к этому правилу. Укажите «с клетчаткой» или "
            "«неизвестно».",
            details={"field": "carbs_convention"},
        )

    await _name_is_free(session, name=payload.name)
    standard = await food_standards_repo.create(session, **payload.model_dump())
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="create",
        entity="food_standards",
        entity_id=standard.id,
        after=payload.model_dump(mode="json"),
    )
    return _read(standard, 0)


@router.put(
    "/{standard_id}",
    response_model=FoodStandardRead,
    summary="Описать стандарт",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def update_standard(
    standard_id: Annotated[uuid.UUID, Path()],
    payload: FoodStandardUpdate,
    user: CurrentUserDep,
    session: SessionDep,
) -> FoodStandardRead:
    """У закрытого стандарта меняется только видимость в списках.

    Название, издатель и версия закрытого стандарта — подпись под его числами,
    та же, что `source` у продукта: переписать её значит приписать документу
    чужие значения. Снять с оборота устаревшую редакцию при этом можно: её
    продукты остаются в блюдах, но в выборе больше не предлагаются.
    """

    standard = await _standard_or_404(session, standard_id)
    before = FoodStandardRead.model_validate(standard).model_dump(mode="json")

    fields = payload.model_dump()
    if standard.locked_at is not None:
        described = {key: value for key, value in fields.items() if key != "is_active"}
        current = {key: getattr(standard, key) for key in described}
        if described != current:
            raise ApiError(
                ErrorCode.CONFLICT,
                "Стандарт закрыт: его описание не меняется. Новая редакция документа "
                "заводится отдельным стандартом.",
            )
    else:
        await _name_is_free(session, name=payload.name, exclude_id=standard_id)

    if standard_id == DEFAULT_FOOD_STANDARD_ID and not payload.is_active:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Основной стандарт клиники нельзя снять с оборота: по нему работают "
            "семья, бот и разбор еды.",
        )

    updated = await food_standards_repo.update(session, standard=standard, **fields)
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="update",
        entity="food_standards",
        entity_id=standard_id,
        before=before,
        after=FoodStandardRead.model_validate(updated).model_dump(mode="json"),
    )
    counts = await food_standards_repo.count_products(session)
    return _read(updated, counts.get(standard_id, 0))


@router.post(
    "/{standard_id}/lock",
    response_model=FoodStandardRead,
    summary="Закрыть стандарт",
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)
async def lock_standard(
    standard_id: Annotated[uuid.UUID, Path()], user: CurrentUserDep, session: SessionDep
) -> FoodStandardRead:
    """Закрытие необратимо: с этого момента значения стандарта не правит никто,
    исправление идёт копией в стандарт клиники (ADR-0056).

    Закрывается только внешний документ (`reference`). Стандарт клиники — её
    рабочая база, и закрыть его значило бы оставить клинику без права править
    собственные продукты; основной стандарт к тому же единственный, который
    видит семья.
    """

    standard = await _standard_or_404(session, standard_id)
    if standard.kind is not FoodStandardKind.REFERENCE:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Закрывается только внешний документ. Стандарт клиники — её рабочая "
            "база, и его значения правятся обычным порядком.",
        )
    try:
        locked = await food_standards_repo.lock(session, standard=standard)
    except food_standards_repo.StandardAlreadyLockedError as error:
        raise ApiError(ErrorCode.CONFLICT, "Стандарт уже закрыт.") from error

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="lock",
        entity="food_standards",
        entity_id=standard_id,
        after={"locked_at": locked.locked_at.isoformat() if locked.locked_at else None},
    )
    counts = await food_standards_repo.count_products(session)
    return _read(locked, counts.get(standard_id, 0))


def _merge_row(row: catalogue_merge.MergeRow) -> CatalogueMergeRow:
    return CatalogueMergeRow(
        food_id=row.food_id,
        name_ru=row.name_ru,
        product_id=row.target.id if row.target is not None else None,
        status=row.status,
        write=row.write,
        accepted=row.accepted,
        fields={
            name: CatalogueMergeField(
                value=value.value,
                source_standard_id=value.source.id if value.source is not None else None,
                source_standard_name=value.source.name if value.source is not None else None,
                source_product_id=value.product_id,
                manual=value.manual,
                conflict=value.conflict,
                merged=value.merged,
                net_plus_fiber=value.net_plus_fiber,
            )
            for name, value in row.fields.items()
        },
        anomalies=row.anomalies,
        missing=row.missing,
        fiber_known=row.fiber_known,
    )


def _merge_totals(rows: list[catalogue_merge.MergeRow]) -> CatalogueMergeTotals:
    totals = CatalogueMergeTotals()
    for row in rows:
        setattr(totals, row.status, getattr(totals, row.status) + 1)
        if row.write:
            totals.written += 1
    return totals


@router.post(
    "/{standard_id}/merge",
    response_model=CatalogueMergeResult,
    summary="Собрать рабочий справочник из источников",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def merge_sources(
    standard_id: Annotated[uuid.UUID, Path()],
    payload: CatalogueMergeRequest,
    user: CurrentUserDep,
    session: SessionDep,
) -> CatalogueMergeResult:
    """Превью (`dry_run`, по умолчанию) или запись слияния (ADR-0067, ADR-0068).

    Цель — стандарт клиники: по нему считают еду ребёнку. Источники — внешние
    документы, по порядку: число берётся из первого, где оно известно. Строки,
    не прошедшие сверку 9–4–4, пишутся только из `accept`; числа, вписанные
    человеком, слияние не трогает и показывает расхождение.
    """

    target = await _standard_or_404(session, standard_id)
    if target.kind is not FoodStandardKind.CLINIC:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Собирается только стандарт клиники: внешний документ не дополняется.",
            details={"field": "standard_id"},
        )
    if target.locked_at is not None:
        raise ApiError(ErrorCode.CONFLICT, "Стандарт закрыт: его значения не меняются.")

    if len(set(payload.source_ids)) != len(payload.source_ids):
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Источник указан дважды.",
            details={"field": "source_ids"},
        )
    sources: list[FoodStandard] = []
    for source_id in payload.source_ids:
        source = await food_standards_repo.get(session, source_id)
        if source is None:
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                "Стандарт-источник не найден.",
                details={"field": "source_ids", "standard_id": str(source_id)},
            )
        if source.kind is not FoodStandardKind.REFERENCE:
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                f"«{source.name}» — не внешний документ. Источником слияния служит "
                "только справочник-источник.",
                details={"field": "source_ids", "standard_id": str(source_id)},
            )
        sources.append(source)

    plan = await catalogue_merge.plan(
        session, target=target, sources=sources, accept=payload.accept
    )
    if not payload.dry_run:
        try:
            await catalogue_merge.apply(session, target=target, plan=plan, changed_by=user.id)
        except products_repo.StandardLockedError as error:
            raise ApiError(
                ErrorCode.CONFLICT, "Стандарт закрыт: его значения не меняются."
            ) from error
        totals = _merge_totals(plan.rows)
        await audit_repo.write_audit_log(
            session,
            user_id=user.id,
            action="merge_sources",
            entity="food_standards",
            entity_id=target.id,
            after={
                "source_ids": [str(source.id) for source in sources],
                "accepted": [str(row.food_id) for row in plan.rows if row.accepted and row.write],
                "totals": totals.model_dump(),
            },
        )

    return CatalogueMergeResult(
        target_id=target.id,
        sources=[CatalogueMergeSource(id=source.id, name=source.name) for source in sources],
        applied=not payload.dry_run,
        rows=[_merge_row(row) for row in plan.rows],
        totals=_merge_totals(plan.rows),
    )


#: Clinical content of a menu: specialists only, the administrator does not need it.
_TEMPLATE_ROLES = (UserRole.DOCTOR, UserRole.DIETITIAN)


@router.get(
    "/{standard_id}/menu-templates",
    response_model=list[MenuTemplateRead],
    summary="Шаблоны меню стандарта",
    dependencies=[Depends(require_roles(*_TEMPLATE_ROLES))],
)
async def list_menu_templates(
    standard_id: Annotated[uuid.UUID, Path()], session: SessionDep
) -> list[MenuTemplateRead]:
    await _standard_or_404(session, standard_id)
    templates = await menu_templates_repo.list_for_standard(session, standard_id=standard_id)
    return [MenuTemplateRead.model_validate(template) for template in templates]


@router.get(
    "/menu-templates/{template_id}",
    response_model=MenuTemplateDetail,
    summary="Шаблон меню по дням",
    dependencies=[Depends(require_roles(*_TEMPLATE_ROLES))],
)
async def get_menu_template(
    template_id: Annotated[uuid.UUID, Path()], session: SessionDep
) -> MenuTemplateDetail:
    template = await menu_templates_repo.get(session, template_id)
    if template is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Шаблон меню не найден.")
    standard = await _standard_or_404(session, template.standard_id)
    rows = await menu_templates_repo.list_items(session, template_id=template.id)

    items: list[MenuTemplateItemRead] = []
    for row in rows:
        recipe = None if row.recipe_id is None else await recipes_repo.get(session, row.recipe_id)
        computed = recipe.computed if recipe is not None else None
        items.append(
            MenuTemplateItemRead(
                cycle_day=row.cycle_day,
                meal_index=row.meal_index,
                dish_title=row.dish_title,
                recipe_id=row.recipe_id,
                kcal=None if computed is None else computed.get("kcal"),
                ratio=None if computed is None else computed.get("ratio"),
            )
        )
    return MenuTemplateDetail(
        template=MenuTemplateRead.model_validate(template),
        diet_type=standard.diet_type,
        items=items,
    )
