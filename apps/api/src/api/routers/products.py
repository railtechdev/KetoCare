"""`/products` — база продуктов (раздел 5.3 ТЗ).

Запись доступна admin/dietitian; каждое изменение пишет ревизию и audit_log.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Path, Query, UploadFile

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import products as products_repo

from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..schemas import (
    ImportRowError,
    Page,
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
    q: str | None = None,
    category_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ProductRead]:
    items, total = await products_repo.search(
        session, q=q, category_id=category_id, limit=limit, offset=offset
    )
    return Page(items=[ProductRead.model_validate(p) for p in items], total=total)


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
    product = await products_repo.create(session, changed_by=user.id, **payload.model_dump())
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
        session, names=[row["name_ru"] for row in report.valid_rows]
    )
    if existing:
        duplicates = [
            ImportRowError(
                line=line,
                column="name_ru",
                message=f"Продукт «{row['name_ru']}» уже есть в базе — строка пропущена.",
            )
            for line, row in enumerate(report.valid_rows, start=2)
            if row["name_ru"] in existing
        ]
        errors.extend(duplicates)
        report.valid_rows = [r for r in report.valid_rows if r["name_ru"] not in existing]

    if dry_run or not report.ok:
        # report.ok учитывает только ошибки разбора: файл с невалидными строками
        # не импортируется вовсе. Дубли же лишь исключают свои строки.
        return ProductImportReport(
            total_rows=report.total_rows, imported=0, errors=errors, dry_run=True
        )

    imported = 0
    for row in report.valid_rows:
        category = await products_repo.get_or_create_category(session, name_ru=row.pop("category"))
        await products_repo.create(session, changed_by=user.id, category_id=category.id, **row)
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
