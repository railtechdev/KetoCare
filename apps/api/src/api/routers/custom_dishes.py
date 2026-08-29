"""`/patients/{patient_id}/custom-dishes` — свои блюда родителя (раздел 5.3 ТЗ).

Состав пересчитывается ядром при каждой записи и сохраняется вместе с
`engine_version`. Удаление — мягкое (правило 4 CLAUDE.md).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Response

from core.models import CustomDish
from core.repositories import custom_dishes as dishes_repo

from ..deps.auth import PatientAccessDep, SessionDep
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
from ..schemas import CustomDishRead, CustomDishWrite, Page
from ..services.dishes import compute_dish, duplicate_product_ids

router = APIRouter(prefix="/patients/{patient_id}/custom-dishes", tags=["custom-dishes"])


def _reject_duplicates(payload: CustomDishWrite) -> None:
    duplicates = duplicate_product_ids(payload.ingredients)
    if duplicates:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Один и тот же продукт указан в составе несколько раз.",
            details={"product_ids": [str(pid) for pid in duplicates]},
        )


@router.get("", response_model=Page[CustomDishRead], summary="Свои блюда пациента")
async def list_dishes(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
    page: PaginationDep,
) -> Page[CustomDishRead]:
    items, total = await dishes_repo.list_for_patient(
        session, patient_id=patient_id, limit=page.limit, offset=page.offset
    )
    return Page(items=[CustomDishRead.model_validate(d) for d in items], total=total)


@router.post("", response_model=CustomDishRead, status_code=201, summary="Сохранить блюдо")
async def create_dish(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: CustomDishWrite,
    session: SessionDep,
    _: PatientAccessDep,
) -> CustomDishRead:
    _reject_duplicates(payload)
    stored, computed, engine_version = await compute_dish(session, ingredients=payload.ingredients)

    dish = await dishes_repo.create(
        session,
        patient_id=patient_id,
        title=payload.title,
        ingredients=stored,
        computed=computed,
        engine_version=engine_version,
    )
    return CustomDishRead.model_validate(dish)


async def _owned_dish(session: SessionDep, dish_id: uuid.UUID, patient_id: uuid.UUID) -> CustomDish:
    """Блюдо, принадлежащее именно этому пациенту.

    Проверка владения отдельно от `require_patient_access`: доступ к пациенту не
    означает права на запись, привязанную к другому пациенту (раздел 5.1 ТЗ).
    Несовпадение отдаём как 404, а не 403 — иначе по коду ответа можно узнать,
    что такое блюдо существует у кого-то ещё.
    """

    dish = await dishes_repo.get(session, dish_id)
    if dish is None or dish.patient_id != patient_id:
        raise ApiError(ErrorCode.NOT_FOUND, "Блюдо не найдено.")
    return dish


@router.put("/{dish_id}", response_model=CustomDishRead, summary="Изменить блюдо")
async def update_dish(
    patient_id: Annotated[uuid.UUID, Path()],
    dish_id: Annotated[uuid.UUID, Path()],
    payload: CustomDishWrite,
    session: SessionDep,
    _: PatientAccessDep,
) -> CustomDishRead:
    dish = await _owned_dish(session, dish_id, patient_id)
    _reject_duplicates(payload)

    stored, computed, engine_version = await compute_dish(session, ingredients=payload.ingredients)
    updated = await dishes_repo.update(
        session,
        dish=dish,
        title=payload.title,
        ingredients=stored,
        computed=computed,
        engine_version=engine_version,
    )
    return CustomDishRead.model_validate(updated)


@router.delete("/{dish_id}", status_code=204, summary="Удалить блюдо")
async def delete_dish(
    patient_id: Annotated[uuid.UUID, Path()],
    dish_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> Response:
    dish = await _owned_dish(session, dish_id, patient_id)
    await dishes_repo.soft_delete(session, dish=dish)
    return Response(status_code=204)
