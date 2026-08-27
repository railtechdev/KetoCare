"""`/products` — база продуктов (раздел 5.3 ТЗ).

Запись доступна admin/dietitian; каждое изменение пишет ревизию и audit_log.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import products as products_repo

from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..schemas import Page, ProductCreate, ProductRead, ProductUpdate

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
