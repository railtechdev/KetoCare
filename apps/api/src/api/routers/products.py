"""`/products` — база продуктов (раздел 5.3 ТЗ).

Запись доступна администратору, диетологу и врачу (ADR-0057); каждое изменение
пишет ревизию и audit_log.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    Path,
    Query,
    Request,
    Response,
    UploadFile,
)
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from core.models import DEFAULT_FOOD_STANDARD_ID, FoodStandard, Product, ProductCategory, User
from core.models.enums import FoodStandardKind, LeadingMacro, UserRole
from core.repositories import audit as audit_repo
from core.repositories import food_standards as food_standards_repo
from core.repositories import products as products_repo
from core.repositories import users as users_repo

from ..deps.auth import CurrentUser, CurrentUserDep, SessionDep, require_roles
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
from ..ratelimit import IMPORT_RATE_LIMIT, limiter
from ..schemas import (
    ImportFieldChange,
    ImportRowError,
    ImportRowUpdate,
    ImportRowWarning,
    Page,
    ProductCategoryMerge,
    ProductCategoryMergeResult,
    ProductCategoryRead,
    ProductCategoryWrite,
    ProductCreate,
    ProductDerive,
    ProductImportReport,
    ProductRead,
    ProductRevisionPage,
    ProductRevisionRead,
    ProductUpdate,
)
from ..services import product_checks, product_recompute, spreadsheet, uploads
from ..services.product_import import ValidRow, parse_csv

router = APIRouter(prefix="/products", tags=["products"])

#: Кто правит справочник. Врач добавлен решением 6 плана стандартов питания
#: (ADR-0057): клиника попросила, чтобы свои продукты вели и врач, и диетолог.
#: Импорт CSV остаётся у администратора — это массовая запись в базу.
_EDITOR_ROLES = (UserRole.ADMIN, UserRole.DIETITIAN, UserRole.DOCTOR)

#: Кому видно, кто и когда правил карточку. Само содержимое справочника открыто
#: всем ролям, а вот имена сотрудников рядом с правками — сведения о работе
#: клиники, и семье они не нужны ни для чего.
_HISTORY_ROLES = (UserRole.ADMIN, UserRole.DIETITIAN, UserRole.DOCTOR)

#: Поля, изменение которых меняет РЕЗУЛЬТАТ расчёта.
_MACRO_FIELDS = ("kcal_100g", "fat_100g", "protein_100g", "carbs_100g", "fiber_100g")


@router.get("", response_model=Page[ProductRead], summary="Поиск продуктов")
async def search_products(
    session: SessionDep,
    user: CurrentUserDep,
    page: PaginationDep,
    q: str | None = None,
    category_id: uuid.UUID | None = None,
    macro: Annotated[
        LeadingMacro | None,
        Query(
            description=(
                "Ведущий макронутриент: на что из трёх приходится больше всего "
                "калорий (9/4/4). Продукты, где ведущего нет — ничья или нет "
                "калорий вовсе, — не попадают ни в один список"
            )
        ),
    ] = None,
    include_inactive: bool = False,
    verified_before: Annotated[
        date | None,
        Query(description="Только позиции, сверявшиеся с источником раньше этой даты"),
    ] = None,
    standard_id: Annotated[
        uuid.UUID | None,
        Query(description="Стандарт питания. Не указан — основной. Семье доступен только основной"),
    ] = None,
) -> Page[ProductRead]:
    """`include_inactive` доступен только тем, кто ведёт справочник.

    Выведенная из оборота позиция не должна попадаться семье при составлении
    меню — в этом и смысл вывода. Но тот, кто её вывел, обязан иметь возможность
    вернуть: раньше параметр существовал в репозитории и не пробрасывался
    ниоткуда, поэтому снятие флажка было НЕОБРАТИМЫМ — позиция исчезала из
    выдачи для всех, включая администратора, и вернуть её можно было только
    через базу.

    `standard_id` от семьи не принимается: обычное питание ребёнку на кетодиете
    назначает только специалист (ADR-0055).
    """

    only_active = not (include_inactive and user.role in _EDITOR_ROLES)
    if user.role is UserRole.PARENT or standard_id is None:
        standard_id = DEFAULT_FOOD_STANDARD_ID
    else:
        await _standard_or_404(session, standard_id)
    items, total = await products_repo.search(
        session,
        q=q,
        category_id=category_id,
        macro=macro,
        only_active=only_active,
        verified_before=verified_before,
        standard_id=standard_id,
        limit=page.limit,
        offset=page.offset,
    )
    return Page(items=[_read_for(user, p) for p in items], total=total)


# Объявлено до "/{product_id}": иначе FastAPI сопоставит "categories" с путевым
# параметром и ответит 422 «не UUID».
@router.get(
    "/categories",
    response_model=list[ProductCategoryRead],
    summary="Категории продуктов",
)
async def list_categories(session: SessionDep, _: CurrentUserDep) -> list[ProductCategoryRead]:
    categories = await products_repo.list_categories(session)
    counts = await products_repo.count_products_by_category(session)
    return [
        ProductCategoryRead.model_validate(c).model_copy(update={"products": counts.get(c.id, 0)})
        for c in categories
    ]


@router.post(
    "/categories",
    response_model=ProductCategoryRead,
    status_code=201,
    summary="Добавить категорию продуктов",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def create_category(
    payload: ProductCategoryWrite, user: CurrentUserDep, session: SessionDep
) -> ProductCategoryRead:
    await _category_name_is_free(session, name_ru=payload.name_ru)

    category = await products_repo.create_category(
        session, name_ru=payload.name_ru, sort=payload.sort
    )
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="create",
        entity="product_categories",
        entity_id=category.id,
        after=ProductCategoryRead.model_validate(category).model_dump(mode="json"),
    )
    return ProductCategoryRead.model_validate(category)


@router.put(
    "/categories/{category_id}",
    response_model=ProductCategoryRead,
    summary="Изменить категорию продуктов",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def update_category(
    category_id: Annotated[uuid.UUID, Path()],
    payload: ProductCategoryWrite,
    user: CurrentUserDep,
    session: SessionDep,
) -> ProductCategoryRead:
    category = await _category_or_404(session, category_id)
    await _category_name_is_free(session, name_ru=payload.name_ru, exclude_id=category_id)

    before = ProductCategoryRead.model_validate(category).model_dump(mode="json")
    updated = await products_repo.update_category(
        session, category=category, name_ru=payload.name_ru, sort=payload.sort
    )
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="update",
        entity="product_categories",
        entity_id=category_id,
        before=before,
        after=ProductCategoryRead.model_validate(updated).model_dump(mode="json"),
    )
    return ProductCategoryRead.model_validate(updated)


@router.post(
    "/categories/{category_id}/merge",
    response_model=ProductCategoryMergeResult,
    summary="Слить категорию с другой",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def merge_category(
    category_id: Annotated[uuid.UUID, Path()],
    payload: ProductCategoryMerge,
    user: CurrentUserDep,
    session: SessionDep,
) -> ProductCategoryMergeResult:
    """Переносит продукты в другую категорию и удаляет опустевшую.

    Единственный способ свести разъехавшийся справочник: удалить непустую
    категорию нельзя — продукты остались бы без неё, — а переносить позиции по
    одной руками это работа на день.
    """

    source = await _category_or_404(session, category_id)
    target = await _category_or_404(session, payload.into_id)
    if source.id == target.id:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Категория сливается сама с собой.")

    before = ProductCategoryRead.model_validate(source).model_dump(mode="json")
    moved = await products_repo.merge_categories(session, source=source, target=target)

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="merge",
        entity="product_categories",
        entity_id=category_id,
        before=before,
        after={
            "into": ProductCategoryRead.model_validate(target).model_dump(mode="json"),
            "moved": moved,
        },
    )
    return ProductCategoryMergeResult(
        category=ProductCategoryRead.model_validate(target), moved=moved
    )


@router.delete(
    "/categories/{category_id}",
    status_code=204,
    summary="Удалить пустую категорию",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def delete_category(
    category_id: Annotated[uuid.UUID, Path()],
    user: CurrentUserDep,
    session: SessionDep,
) -> Response:
    category = await _category_or_404(session, category_id)

    used = await products_repo.count_products_in_category(session, category_id=category_id)
    if used:
        raise ApiError(
            ErrorCode.CONFLICT,
            f"В категории {used} позиций. Слейте её с другой категорией "
            "или перенесите продукты — иначе они останутся без категории.",
            details={"products": used},
        )

    before = ProductCategoryRead.model_validate(category).model_dump(mode="json")
    await session.delete(category)
    await session.flush()

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="delete",
        entity="product_categories",
        entity_id=category_id,
        before=before,
    )
    return Response(status_code=204)


def _read_for(user: CurrentUser, product: Product) -> ProductRead:
    """Семье не отдаётся ссылка на оригинал копии.

    Оригинал лежит в стандарте, которого у неё нет: его идентификатор дал бы
    посчитать своё блюдо по закрытой записи (ADR-0057).
    """

    read = ProductRead.model_validate(product)
    if user.role is UserRole.PARENT:
        # Происхождение чисел ссылается на ту же закрытую запись и на сотрудников.
        return read.model_copy(update={"derived_from_id": None, "value_sources": {}})
    return read


async def _labelled_read_for(
    session: SessionDep, user: CurrentUser, product: Product
) -> ProductRead:
    """`_read_for` с подписями происхождения чисел, собранными на сервере.

    Карточке нужно «Стандарт X» или «правка: имя, дата» рядом с числом; без
    подписи ей пришлось бы ходить за стандартом и сотрудником отдельными
    запросами на каждое поле.
    """

    read = _read_for(user, product)
    if not read.value_sources:
        return read
    labels: dict[uuid.UUID, str | None] = {}
    for item in read.value_sources.values():
        if item.kind == "product" and item.product_id and item.product_id not in labels:
            origin = await session.get(Product, item.product_id)
            standard = (
                await session.get(FoodStandard, origin.standard_id) if origin is not None else None
            )
            labels[item.product_id] = standard.name if standard is not None else None
        elif item.kind == "manual" and item.user_id and item.user_id not in labels:
            author = await session.get(User, item.user_id)
            labels[item.user_id] = author.full_name if author is not None else None
    sources = {
        field: item.model_copy(
            update={"label": labels.get(item.product_id or item.user_id)}  # type: ignore[arg-type]
        )
        for field, item in read.value_sources.items()
    }
    return read.model_copy(update={"value_sources": sources})


def _manual_source(user_id: uuid.UUID) -> dict[str, str]:
    return {"kind": "manual", "user_id": str(user_id), "at": datetime.now(UTC).isoformat()}


def _changed_values(product: Product, payload: BaseModel) -> list[str]:
    return [
        field
        for field in _MACRO_FIELDS
        if abs(float(getattr(product, field)) - float(getattr(payload, field))) > 1e-9
    ]


async def _standard_or_404(session: SessionDep, standard_id: uuid.UUID) -> FoodStandard:
    standard = await food_standards_repo.get(session, standard_id)
    if standard is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Стандарт питания не найден.")
    return standard


#: Подписи полей для сообщений — как в форме продукта.
_FIELD_NAMES = {
    "kcal_100g": "калорийность",
    "fat_100g": "жиры",
    "protein_100g": "белки",
    "carbs_100g": "углеводы",
    "fiber_100g": "клетчатка",
}


def _unknown_in_clinic(fields: list[str]) -> ApiError:
    names = ", ".join(_FIELD_NAMES.get(field, field) for field in fields)
    return ApiError(
        ErrorCode.VALIDATION_ERROR,
        f"В источнике нет данных: {names}. В стандарте клиники по этим числам "
        "считают еду ребёнку — впишите значение или подтвердите, что оно верно.",
        details={"fields": fields},
    )


def _standard_locked() -> ApiError:
    return ApiError(
        ErrorCode.CONFLICT,
        "Стандарт закрыт: его значения не меняются. Скорректировать продукт можно "
        "копией в стандарте клиники.",
    )


async def _category_or_404(session: SessionDep, category_id: uuid.UUID) -> ProductCategory:
    category = await products_repo.get_category(session, category_id)
    if category is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Категория не найдена.")
    return category


async def _category_name_is_free(
    session: SessionDep, *, name_ru: str, exclude_id: uuid.UUID | None = None
) -> None:
    """Имя занято — 409 с объяснением, а не 500 от уникального индекса.

    Сверка идёт без учёта регистра и внешних пробелов, как и сам индекс: «Жиры»
    и «жиры» — одна категория, и разъезжаться справочнику больше нельзя.
    """

    existing = await products_repo.find_category_by_name(
        session, name_ru=name_ru, exclude_id=exclude_id
    )
    if existing is not None:
        raise ApiError(
            ErrorCode.CONFLICT,
            f"Категория «{existing.name_ru}» уже есть — названия различаются только "
            "регистром или пробелами.",
            details={"category_id": str(existing.id)},
        )


class ProductAnomalyRead(BaseModel):
    """Находка по одному продукту.

    Класс и числа — кодами: русский текст живёт в словарях фронтенда
    (правило 8 CLAUDE.md), а не собирается здесь.
    """

    kind: str
    values: dict[str, float]
    field: str


class ProductValuesCheck(BaseModel):
    """Пищевая ценность на 100 г — то, по чему считаются проверки."""

    kcal_100g: Annotated[float, Field(ge=0, le=10000)]
    fat_100g: Annotated[float, Field(ge=0, le=1000)]
    protein_100g: Annotated[float, Field(ge=0, le=1000)]
    carbs_100g: Annotated[float, Field(ge=0, le=1000)]
    fiber_100g: Annotated[float, Field(ge=0, le=1000)] = 0


def _anomalies_of(
    values: ProductValuesCheck | dict[str, Any], *, unknown: Collection[str] = ()
) -> list[ProductAnomalyRead]:
    """Находки по значениям — одна дорога для списка, карточки и импорта."""

    raw = values.model_dump() if isinstance(values, BaseModel) else values
    return [
        ProductAnomalyRead(kind=item.kind.value, values=item.values, field=item.field)
        for item in product_checks.check(
            product_checks.Values(
                kcal=float(raw["kcal_100g"]),
                fat=float(raw["fat_100g"]),
                protein=float(raw["protein_100g"]),
                carbs=float(raw["carbs_100g"]),
                fiber=float(raw.get("fiber_100g") or 0),
            ),
            unknown=unknown,
        )
    ]


class ProductWithAnomalies(BaseModel):
    product_id: uuid.UUID
    name_ru: str
    is_active: bool
    anomalies: list[ProductAnomalyRead]


# Объявлен ДО `/{product_id}`: маршруты разбираются в порядке объявления, и
# перенос этого блока ниже превратил бы «anomalies» в идентификатор продукта.
@router.get(
    "/anomalies",
    response_model=Page[ProductWithAnomalies],
    summary="Продукты с подозрительными значениями",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def list_anomalies(
    session: SessionDep,
    _: CurrentUserDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ProductWithAnomalies]:
    """Проверка базы на аномалии (раздел 10.1 ТЗ, задача `content_draft`).

    Считается арифметикой, а не моделью: обе проверки, которые называет ТЗ, —
    счёт, а счёт, отданный модели, становится непроверяемым (ADR-0024). Границы
    те же, что у импорта, — один модуль на оба места.

    База просматривается целиком, пагинация применяется к находкам: «аномалий
    нет» должно означать «нет в базе», а не «нет на этой странице».
    """

    rows = await products_repo.list_values(session)
    found = [
        ProductWithAnomalies(
            product_id=row.id,
            name_ru=row.name_ru,
            is_active=row.is_active,
            anomalies=anomalies,
        )
        for row, anomalies in (
            (
                row,
                _anomalies_of(
                    {
                        "kcal_100g": row.kcal_100g,
                        "fat_100g": row.fat_100g,
                        "protein_100g": row.protein_100g,
                        "carbs_100g": row.carbs_100g,
                        "fiber_100g": row.fiber_100g,
                    },
                    unknown=row.unknown_fields,
                ),
            )
            for row in rows
        )
        if anomalies
    ]
    return Page(items=found[offset : offset + limit], total=len(found))


@router.post(
    "/check",
    response_model=list[ProductAnomalyRead],
    summary="Проверить значения продукта до сохранения",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def check_product_values(
    payload: ProductValuesCheck, _: CurrentUserDep
) -> list[ProductAnomalyRead]:
    """Те же проверки, что у списка подозрительных, — по значениям из формы.

    Потребитель — карточка продукта в кабинете (`features/admin/ProductForm.tsx`):
    она показывает предупреждение по мере ввода, не дожидаясь сохранения.
    Предупреждение, а не запрет: ответ клиники на вопрос 1 — «нужно
    предупреждать». Коэффициенты 9 — 4 — 4 живут в ядре, и копии в браузере
    нет. Ничего не сохраняет и в журнал не пишет.
    """

    return _anomalies_of(payload)


@router.get("/{product_id}", response_model=ProductRead, summary="Карточка продукта")
async def get_product(
    product_id: Annotated[uuid.UUID, Path()], session: SessionDep, user: CurrentUserDep
) -> ProductRead:
    product = await products_repo.get(session, product_id)
    # Для семьи записи другого стандарта нет, как и в поиске.
    if product is None or (
        user.role is UserRole.PARENT and product.standard_id != DEFAULT_FOOD_STANDARD_ID
    ):
        raise ApiError(ErrorCode.NOT_FOUND, "Продукт не найден.")
    return await _labelled_read_for(session, user, product)


@router.post(
    "",
    response_model=ProductRead,
    status_code=201,
    summary="Добавить продукт",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def create_product(
    payload: ProductCreate, user: CurrentUserDep, session: SessionDep
) -> ProductRead:
    # Уникальность имени держит функциональный индекс по lower(btrim(name_ru)).
    # Без перехвата он давал «Внутренняя ошибка сервера»: администратор,
    # добавляющий «Масло сливочное», которое уже пришло из USDA, видел отказ
    # сервера и не понимал, что это дубль.
    #
    # Проверка «прочитать, затем вставить» тут не годится: два одновременных
    # заведения проходят её оба, а индекс — последняя защита от двух записей с
    # одним названием и разными числами.
    standard_id = payload.standard_id or DEFAULT_FOOD_STANDARD_ID
    await _standard_or_404(session, standard_id)
    try:
        product = await products_repo.create(
            session,
            changed_by=user.id,
            standard_id=standard_id,
            **payload.model_dump(exclude={"standard_id"}),
        )
        await session.flush()
    except products_repo.StandardLockedError as error:
        raise _standard_locked() from error
    except products_repo.UnknownValueInClinicError as error:
        raise _unknown_in_clinic(error.fields) from error
    except IntegrityError as error:
        raise ApiError(
            ErrorCode.CONFLICT,
            f"Продукт «{payload.name_ru}» уже есть в справочнике.",
        ) from error
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="create",
        entity="products",
        entity_id=product.id,
        after=payload.model_dump(mode="json"),
    )
    return ProductRead.model_validate(product)


@router.put(
    "/{product_id}",
    response_model=ProductRead,
    summary="Изменить продукт",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def update_product(
    product_id: Annotated[uuid.UUID, Path()],
    payload: ProductUpdate,
    user: CurrentUserDep,
    session: SessionDep,
) -> ProductRead:
    product = await products_repo.get(session, product_id)
    if product is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Продукт не найден.")

    _source_must_match_numbers(product, payload)

    before = ProductRead.model_validate(product).model_dump(mode="json")
    # Поправленное число подписывается автором правки; нетронутые сохраняют
    # прежнее происхождение. Словарь новый — изменение JSONB на месте ORM не видит.
    unknown_before = list(product.unknown_fields or [])
    # Подтверждённое человеком число — его правка, даже если оно не изменилось.
    confirmed = [field for field in payload.confirmed_fields if field in unknown_before]
    changed = list(dict.fromkeys([*_changed_values(product, payload), *confirmed]))
    value_sources = {
        **(product.value_sources or {}),
        **{field: _manual_source(user.id) for field in changed},
    }
    # Вписанное или подтверждённое человеком число перестаёт быть «нет данных».
    unknown_fields = [field for field in unknown_before if field not in changed]
    extra: dict[str, Any] = {}
    if "fiber_100g" in confirmed:
        extra["fiber_known"] = True
    try:
        updated = await products_repo.update(
            session,
            product=product,
            changed_by=user.id,
            value_sources=value_sources,
            unknown_fields=unknown_fields,
            **extra,
            **payload.model_dump(exclude={"confirmed_fields"}),
        )
    except products_repo.StandardLockedError as error:
        raise _standard_locked() from error
    except products_repo.UnknownValueInClinicError as error:
        raise _unknown_in_clinic(error.fields) from error

    after = ProductRead.model_validate(updated).model_dump(mode="json")
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="update",
        entity="products",
        entity_id=product_id,
        before=before,
        after=after,
    )
    # Числа продукта или отметка «приправа» изменились — рецепты и блюда, где он
    # стоит, пересчитываются сразу, а не при следующей их записи.
    if changed or before.get("counts_in_calculation") != after.get("counts_in_calculation"):
        await product_recompute.recompute_after_product_change(
            session, product_id=product_id, user_id=user.id
        )
    return await _labelled_read_for(session, user, updated)


def _source_must_match_numbers(
    product: Product,
    payload: ProductUpdate | ProductDerive,
    *,
    require_new_source: bool = False,
) -> None:
    """Числа изменились — источник обязан измениться вместе с ними.

    У каждой позиции справочника есть подпись: откуда взяты значения
    (`source`), какая это версия базы (`source_version`) и когда сверяли
    (`verified_at`). Пока подпись стоит от USDA, строка утверждает, что её
    числа опубликовал USDA. Правка жиров с сохранением этой подписи превращает
    утверждение в ложное — и проверить значение по источнику становится нельзя
    ни задним числом, ни при следующем обновлении базы.

    Это правило работы с базами состава продуктов (EuroFIR: у каждого значения
    прослеживаемый источник), а не наша выдумка. Запрета на правку здесь нет:
    менять числа можно, нельзя оставлять чужую подпись под своими числами.

    `require_new_source` — для копии: новая версия того же документа законна при
    обновлении базы, но поправленные специалистом числа документ не публиковал.
    """

    changed = _changed_values(product, payload)
    if not changed:
        return

    if require_new_source:
        if product.source != payload.source:
            return
    elif (product.source, product.source_version) != (payload.source, payload.source_version):
        return

    raise ApiError(
        ErrorCode.VALIDATION_ERROR,
        "Числа изменились, а источник остался прежним. Укажите, откуда взяты "
        "новые значения: подписывать их прежним источником нельзя — по такой "
        "записи значение уже не проверить.",
        details={"fields": changed, "source": product.source},
    )


@router.post(
    "/{product_id}/derive",
    response_model=ProductRead,
    status_code=201,
    summary="Скорректировать: копия продукта в стандарте клиники",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def derive_product(
    product_id: Annotated[uuid.UUID, Path()],
    payload: ProductDerive,
    user: CurrentUserDep,
    session: SessionDep,
) -> ProductRead:
    """Значения закрытого стандарта не правятся (ADR-0056). Исправление — копия в
    стандарте клиники со ссылкой на оригинал и тем же тождеством продукта:
    исключение ребёнка действует на обе записи.

    Копия подчиняется тому же правилу подписи, что правка: числа изменились —
    источник обязан измениться вместе с ними. Иначе под поправленными числами
    стояла бы подпись документа, который их не публиковал.
    """

    source = await products_repo.get(session, product_id)
    if source is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Продукт не найден.")

    standard_id = payload.standard_id or DEFAULT_FOOD_STANDARD_ID
    target = await _standard_or_404(session, standard_id)
    if target.locked_at is not None:
        raise _standard_locked()
    if not target.is_active:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Стандарт снят с оборота: копия в нём никому не будет предложена.",
            details={"field": "standard_id"},
        )
    if target.kind is not FoodStandardKind.CLINIC:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Копия кладётся в стандарт клиники: внешний документ не дополняется.",
            details={"field": "standard_id"},
        )
    if target.id == source.standard_id:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Продукт уже в этом стандарте — правьте его карточку.",
            details={"field": "standard_id"},
        )

    _source_must_match_numbers(source, payload, require_new_source=True)

    # До записи: после отказа индекса транзакция откатывается, и чтение атрибута
    # загруженного стандарта падает вместо ответа 409.
    target_name = target.name
    fields = payload.model_dump(exclude={"standard_id", "confirmed_fields"})
    fiber_changed = products_repo.fiber_differs(source.fiber_100g, payload.fiber_100g)
    unknown_before = list(source.unknown_fields or [])
    confirmed = {field for field in payload.confirmed_fields if field in unknown_before}
    changed = set(_changed_values(source, payload)) | confirmed
    # Копия ложится в стандарт клиники, по которому считают ребёнку: прочерк
    # источника в жирах, белках или углеводах там не остаётся. Его надо
    # вписать или подтвердить — иначе 0 на месте «нет данных» ушёл бы в расчёт.
    unknown_energy = [
        field
        for field in unknown_before
        if field in products_repo.ENERGY_FIELDS and field not in changed
    ]
    if unknown_energy:
        raise _unknown_in_clinic(unknown_energy)
    value_sources = {
        field: _manual_source(user.id)
        if field in changed
        else {"kind": "product", "product_id": str(source.id)}
        for field in _MACRO_FIELDS
    }
    try:
        product = await products_repo.create(
            session,
            changed_by=user.id,
            standard_id=target.id,
            derived_from_id=source.id,
            food_id=source.food_id,
            # Клетчатка известна, если её знал источник или её вписали в копии.
            fiber_known=source.fiber_known or fiber_changed or "fiber_100g" in confirmed,
            value_sources=value_sources,
            # Остаться может только клетчатка: репозиторий снимет пометку и
            # оставит `fiber_known = false`.
            unknown_fields=[field for field in unknown_before if field not in changed],
            waste_pct=source.waste_pct,
            **fields,
        )
        await session.flush()
    except products_repo.StandardLockedError as error:
        raise _standard_locked() from error
    except products_repo.UnknownValueInClinicError as error:
        raise _unknown_in_clinic(error.fields) from error
    except IntegrityError as error:
        raise ApiError(
            ErrorCode.CONFLICT,
            f"Продукт «{payload.name_ru}» уже есть в стандарте «{target_name}».",
        ) from error

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="create",
        entity="products",
        entity_id=product.id,
        after={
            **payload.model_dump(mode="json"),
            "standard_id": str(target.id),
            "derived_from_id": str(source.id),
            "food_id": str(product.food_id),
            "fiber_known": product.fiber_known,
            "value_sources": value_sources,
            "unknown_fields": product.unknown_fields,
            "waste_pct": float(product.waste_pct) if product.waste_pct is not None else None,
        },
    )
    return await _labelled_read_for(session, user, product)


@router.get(
    "/{product_id}/revisions",
    response_model=ProductRevisionPage,
    summary="История изменений продукта",
    dependencies=[Depends(require_roles(*_HISTORY_ROLES))],
)
async def list_product_revisions(
    product_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: CurrentUserDep,
    page: PaginationDep,
) -> ProductRevisionPage:
    """История пишется репозиторием с первого дня и не отдавалась никуда.

    Экран показывал вместо неё журнал аудита, отобранный по `entity_id`, — а
    импорт пишет одну запись на весь файл, без идентификатора продукта. Поэтому
    у всех импортированных позиций история выглядела пустой, хотя в базе она
    была с самого их появления.
    """

    product = await products_repo.get(session, product_id)
    if product is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Продукт не найден.")

    revisions = await products_repo.list_revisions(session, product_id=product_id)
    window = revisions[page.offset : page.offset + page.limit]

    # Имена — одним запросом на страницу, а не по одному на строку.
    names = await users_repo.names_by_ids(
        session, user_ids={revision.changed_by for revision in window}
    )

    return ProductRevisionPage(
        items=[
            ProductRevisionRead(
                id=revision.id,
                snapshot=revision.snapshot,
                changed_by=revision.changed_by,
                changed_by_name=names.get(revision.changed_by),
                changed_at=revision.changed_at,
            )
            for revision in window
        ],
        total=len(revisions),
    )


# 5 МБ: база продуктов — тысячи строк, а не десятки тысяч; ограничение защищает
# воркер от разбора произвольно большого файла в памяти. Само чтение — в
# `services.uploads`: тот же предел нужен импорту рецептов.


@router.post(
    "/import",
    response_model=ProductImportReport,
    summary="Импорт продуктов из CSV или Excel (с превью)",
    # Загружают те же, кто правит справочник (ADR-0064): диетолог вела базу по
    # одной карточке, хотя импорт с превью уже был.
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
@limiter.limit(IMPORT_RATE_LIMIT)
async def import_products(
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
    file: Annotated[UploadFile, File()],
    dry_run: bool = True,
    update_existing: bool = False,
    standard_id: uuid.UUID = DEFAULT_FOOD_STANDARD_ID,
) -> ProductImportReport:
    """`dry_run=true` (по умолчанию) — только превью и построчный отчёт об ошибках.

    `update_existing=true` — обновляющий импорт: строка с уже существующим
    названием не отбрасывается как дубль, а переписывает позицию. Нужен при
    выходе новой версии базы состава: без него 98 позиций обновляются руками по
    одной карточке.

    Запись выполняется единой транзакцией: файл с ошибками не импортируется
    частично.

    Файл попадает в один стандарт, и совпадения ищутся только в нём. В закрытый
    стандарт импорт отказывает сразу, ещё на превью.
    """

    standard = await _standard_or_404(session, standard_id)
    if standard.locked_at is not None:
        raise _standard_locked()

    content = await uploads.read_within_limit(file)
    if spreadsheet.is_xlsx(content):
        try:
            content = spreadsheet.xlsx_to_csv(content)
        except spreadsheet.SpreadsheetError as exc:
            raise ApiError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc

    # Пустая ячейка значения — «нет данных» — допустима только в
    # справочнике-источнике (ADR-0067): рабочий справочник требует числа.
    report = parse_csv(content, allow_unknown=standard.kind is FoodStandardKind.REFERENCE)
    errors = [
        ImportRowError(line=e.line, column=e.column, message=e.message) for e in report.errors
    ]

    existing = await products_repo.get_by_names(
        session, names=[row.values["name_ru"] for row in report.valid_rows], standard_id=standard_id
    )

    def _key(row: ValidRow) -> str:
        return str(row.values["name_ru"]).casefold().strip()

    matched = [row for row in report.valid_rows if _key(row) in existing]
    report.valid_rows = [row for row in report.valid_rows if _key(row) not in existing]

    # Калорийность, не сходящаяся с составом (ответ клиники на вопрос 1), —
    # предупреждение в превью, а не ошибка: строка импортируется. Считается по
    # новым строкам и — при обновляющем импорте — по обновляющим: те и другие
    # станут значениями справочника. Дубли без обновления отбрасываются, и
    # предупреждать о них незачем.
    warnings = [
        ImportRowWarning(
            line=row.line,
            name_ru=str(row.values["name_ru"]),
            kind=anomaly.kind,
            values=anomaly.values,
        )
        for row in sorted(
            [*report.valid_rows, *(matched if update_existing else [])],
            key=lambda item: item.line,
        )
        for anomaly in _anomalies_of(row.values, unknown=row.values["unknown_fields"])
        if anomaly.kind == product_checks.Anomaly.KCAL_MISMATCH
    ]

    updates: list[ImportRowUpdate] = []
    if update_existing:
        for row in matched:
            product = existing[_key(row)]
            changes = _import_changes(product, row.values)
            signature = _import_signature_error(product, row)
            if signature is not None:
                errors.append(signature)
                continue
            if changes:
                updates.append(
                    ImportRowUpdate(
                        line=row.line,
                        product_id=product.id,
                        name_ru=product.name_ru,
                        changes=changes,
                    )
                )
    else:
        # Дубли — не ошибка формата, но импортировать их молча нельзя: одинаковое
        # имя с разными значениями означает риск выбрать «не тот» продукт при
        # расчёте меню. Номер строки берётся из самой строки: `valid_rows` не
        # сплошной, и нумерация по индексу приписала бы дубль не той строке файла.
        errors.extend(
            ImportRowError(
                line=row.line,
                column="name_ru",
                message=(
                    f"Продукт «{row.values['name_ru']}» уже есть в базе — строка пропущена. "
                    "Чтобы обновить существующие позиции, включите обновляющий импорт."
                ),
            )
            for row in matched
        )

    if dry_run or not report.ok or errors:
        # `dry_run` в ответе отражает то, что запросил клиент. Файл с ошибками
        # разбора не импортируется целиком (частичный импорт базы продуктов хуже
        # отказа), но выдавать отказ за превью нельзя: интерфейс, ориентирующийся
        # на флаг, зациклится на «предпросмотр готов, нажмите импорт».
        return ProductImportReport(
            total_rows=report.total_rows,
            # В превью `imported` — сколько позиций БУДЕТ заведено, а не ноль.
            # Ноль читался как «ничего не запишется» ровно там, где решают,
            # нажимать ли импорт: администратор видел «строк в файле: 412» и не
            # знал, сколько из них новые. При отказе (ошибки разбора) запись не
            # состоится вовсе — там ноль честен.
            imported=len(report.valid_rows) if dry_run and report.ok and not errors else 0,
            updated=len(updates),
            updates=updates,
            errors=errors,
            warnings=warnings,
            dry_run=dry_run,
        )

    imported = 0
    for row in report.valid_rows:
        values = dict(row.values)
        category = await products_repo.get_or_create_category(
            session, name_ru=values.pop("category")
        )
        if "fiber_100g" in values["unknown_fields"]:
            # Прочерк в клетчатке — тот же случай, что источник без клетчатки.
            values["fiber_known"] = False
        await products_repo.create(
            session,
            changed_by=user.id,
            category_id=category.id,
            standard_id=standard_id,
            **values,
        )
        imported += 1

    updated = 0
    for update in updates:
        row = next(r for r in matched if r.line == update.line)
        values = dict(row.values)
        category = await products_repo.get_or_create_category(
            session, name_ru=values.pop("category")
        )
        product = existing[_key(row)]
        if "fiber_100g" in values["unknown_fields"]:
            values["fiber_known"] = False
        elif "fiber_100g" in (product.unknown_fields or []):
            # Прежде прочерк, теперь число: клетчатка стала известной, даже
            # если число совпало с нулём, который лежал на месте прочерка.
            values["fiber_known"] = True
        before = ProductRead.model_validate(product).model_dump(mode="json")
        # Импорт подписывает всю строку своим источником: прежние пометки
        # отдельных чисел описывали бы уже не те значения.
        changed = await products_repo.update(
            session,
            product=product,
            changed_by=user.id,
            category_id=category.id,
            value_sources={},
            **values,
        )
        # Каждая правка — своя запись аудита с before/after: «обновлено 412
        # позиций» одной строкой не отвечает на вопрос, что именно изменилось в
        # конкретной карточке, а спрашивают об этом после инцидента.
        await audit_repo.write_audit_log(
            session,
            user_id=user.id,
            action="update",
            entity="products",
            entity_id=product.id,
            before=before,
            after=ProductRead.model_validate(changed).model_dump(mode="json"),
        )
        updated += 1

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="import",
        entity="products",
        after={
            "imported": imported,
            "updated": updated,
            "filename": file.filename,
            "standard_id": str(standard_id),
        },
    )

    return ProductImportReport(
        total_rows=report.total_rows,
        imported=imported,
        updated=updated,
        updates=updates,
        errors=errors,
        warnings=warnings,
        dry_run=False,
    )


#: Поля, которые обновляющий импорт переписывает и показывает в превью.
_IMPORT_FIELDS = (
    "name_ru",
    "name_uz",
    "name_en",
    "kcal_100g",
    "fat_100g",
    "protein_100g",
    "carbs_100g",
    "fiber_100g",
    "source",
    "source_version",
    "verified_at",
    # Только когда колонка в файле есть и ячейка не пуста (`product_import`).
    "counts_in_calculation",
    "waste_pct",
    # Поля с прочерком в источнике: тот же 0 в числе, но другое утверждение.
    "unknown_fields",
)


def _import_changes(product: Product, values: dict[str, Any]) -> list[ImportFieldChange]:
    """Чем строка файла отличается от того, что уже в базе."""

    changes: list[ImportFieldChange] = []
    for field in _IMPORT_FIELDS:
        if field not in values:
            continue
        before = getattr(product, field)
        after = values[field]
        if isinstance(before, Decimal) or isinstance(after, float):
            if abs(float(before or 0) - float(after or 0)) < 1e-9:
                continue
        elif str(before or "") == str(after or ""):
            continue
        changes.append(
            ImportFieldChange(field=field, before=_format_value(before), after=_format_value(after))
        )
    return changes


def _format_value(value: object) -> str:
    """Значение для человека: «81.1», а не «81.10».

    В базе жиры лежат как `Numeric`, в файле приходят строкой, и без приведения
    строка различий выглядела бы как «81.10 → 82.5» — читается как разные
    форматы, а не как правка одного числа.
    """

    if value is None:
        return ""
    if isinstance(value, bool):
        # Отметка «учитывается в расчёте» — словами, как её и пишут в файле.
        return "да" if value else "нет"
    if isinstance(value, list):
        # Поля без данных — именами колонок файла, как их видит загружающий.
        return ", ".join(str(item) for item in value)
    if isinstance(value, Decimal | float | int) and not isinstance(value, bool):
        return f"{float(value):g}"
    return str(value)


def _import_signature_error(product: Product, row: ValidRow) -> ImportRowError | None:
    """Та же подпись источника, что и при ручной правке.

    Файл новой версии базы состава приходит с новой `source_version`, и это
    нормальный случай. А вот та же версия с другими числами означает, что
    значения кто-то поправил и подписал прежним источником — проверить их по
    нему станет нельзя (правило EuroFIR).
    """

    values = row.values
    macros_changed = any(
        abs(float(getattr(product, field)) - float(values[field])) > 1e-9
        for field in _MACRO_FIELDS
        if field in values
    )
    if not macros_changed:
        return None

    same_signature = (product.source, product.source_version) == (
        values.get("source"),
        values.get("source_version"),
    )
    if not same_signature:
        return None

    return ImportRowError(
        line=row.line,
        column="source_version",
        message=(
            f"У продукта «{product.name_ru}» изменились числа, а источник остался "
            "прежним. Укажите версию источника новых значений: подписывать их "
            "прежним нельзя — по такой записи значение уже не проверить."
        ),
    )
