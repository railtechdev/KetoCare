"""`/products` — база продуктов (раздел 5.3 ТЗ).

Запись доступна admin/dietitian; каждое изменение пишет ревизию и audit_log.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Path, UploadFile
from sqlalchemy.exc import IntegrityError

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import products as products_repo

from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
from ..schemas import (
    ImportRowError,
    Page,
    ProductCategoryRead,
    ProductCreate,
    ProductImportReport,
    ProductRead,
    ProductUpdate,
)
from ..services.product_import import parse_csv

router = APIRouter(prefix="/products", tags=["products"])

_EDITOR_ROLES = (UserRole.ADMIN, UserRole.DIETITIAN)


@router.get("", response_model=Page[ProductRead], summary="Поиск продуктов")
async def search_products(
    session: SessionDep,
    _: CurrentUserDep,
    page: PaginationDep,
    q: str | None = None,
    category_id: uuid.UUID | None = None,
) -> Page[ProductRead]:
    items, total = await products_repo.search(
        session, q=q, category_id=category_id, limit=page.limit, offset=page.offset
    )
    return Page(items=[ProductRead.model_validate(p) for p in items], total=total)


# Объявлено до "/{product_id}": иначе FastAPI сопоставит "categories" с путевым
# параметром и ответит 422 «не UUID».
@router.get(
    "/categories",
    response_model=list[ProductCategoryRead],
    summary="Категории продуктов",
)
async def list_categories(session: SessionDep, _: CurrentUserDep) -> list[ProductCategoryRead]:
    categories = await products_repo.list_categories(session)
    return [ProductCategoryRead.model_validate(c) for c in categories]


@router.get("/{product_id}", response_model=ProductRead, summary="Карточка продукта")
async def get_product(
    product_id: Annotated[uuid.UUID, Path()], session: SessionDep, _: CurrentUserDep
) -> ProductRead:
    product = await products_repo.get(session, product_id)
    if product is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Продукт не найден.")
    return ProductRead.model_validate(product)


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
    try:
        product = await products_repo.create(session, changed_by=user.id, **payload.model_dump())
        await session.flush()
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

    before = ProductRead.model_validate(product).model_dump(mode="json")
    updated = await products_repo.update(
        session, product=product, changed_by=user.id, **payload.model_dump()
    )

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="update",
        entity="products",
        entity_id=product_id,
        before=before,
        after=ProductRead.model_validate(updated).model_dump(mode="json"),
    )
    return ProductRead.model_validate(updated)


# 5 МБ: база продуктов — тысячи строк, а не десятки тысяч; ограничение защищает
# воркер от разбора произвольно большого файла в памяти.
MAX_IMPORT_BYTES = 5 * 1024 * 1024


@router.post(
    "/import",
    response_model=ProductImportReport,
    summary="Импорт продуктов из CSV (с превью)",
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)
async def import_products(
    user: CurrentUserDep,
    session: SessionDep,
    file: Annotated[UploadFile, File()],
    dry_run: bool = True,
) -> ProductImportReport:
    """`dry_run=true` (по умолчанию) — только превью и построчный отчёт об ошибках.

    Запись выполняется единой транзакцией: файл с ошибками не импортируется частично.
    """

    content = await file.read()
    if len(content) > MAX_IMPORT_BYTES:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Файл больше {MAX_IMPORT_BYTES // (1024 * 1024)} МБ.",
        )

    report = parse_csv(content)
    errors = [
        ImportRowError(line=e.line, column=e.column, message=e.message) for e in report.errors
    ]

    # Дубли — не ошибка формата, но импортировать их молча нельзя: одинаковое имя
    # с разными значениями означает риск выбрать «не тот» продукт при расчёте меню.
    existing = await products_repo.find_duplicate_names(
        session, names=[row.values["name_ru"] for row in report.valid_rows]
    )
    if existing:
        # Номер строки берётся из самой строки, а не из позиции в списке:
        # valid_rows не сплошной (строки с ошибками в него не попали), поэтому
        # нумерация по индексу приписала бы дубль не той строке файла.
        errors.extend(
            ImportRowError(
                line=row.line,
                column="name_ru",
                message=f"Продукт «{row.values['name_ru']}» уже есть в базе — строка пропущена.",
            )
            for row in report.valid_rows
            if row.values["name_ru"].casefold().strip() in existing
        )
        report.valid_rows = [
            row
            for row in report.valid_rows
            if row.values["name_ru"].casefold().strip() not in existing
        ]

    if dry_run or not report.ok:
        # `dry_run` в ответе отражает то, что запросил клиент. Файл с ошибками
        # разбора не импортируется целиком (частичный импорт базы продуктов хуже
        # отказа), но выдавать отказ за превью нельзя: интерфейс, ориентирующийся
        # на флаг, зациклится на «предпросмотр готов, нажмите импорт».
        return ProductImportReport(
            total_rows=report.total_rows, imported=0, errors=errors, dry_run=dry_run
        )

    imported = 0
    for row in report.valid_rows:
        values = dict(row.values)
        category = await products_repo.get_or_create_category(
            session, name_ru=values.pop("category")
        )
        await products_repo.create(session, changed_by=user.id, category_id=category.id, **values)
        imported += 1

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="import",
        entity="products",
        after={"imported": imported, "filename": file.filename},
    )

    return ProductImportReport(
        total_rows=report.total_rows, imported=imported, errors=errors, dry_run=False
    )
