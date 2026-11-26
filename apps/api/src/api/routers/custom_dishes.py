"""`/patients/{patient_id}/custom-dishes` — свои блюда родителя (раздел 5.3 ТЗ).

Состав пересчитывается ядром при каждой записи и сохраняется вместе с
`engine_version`. Удаление — мягкое (правило 4 CLAUDE.md).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Path, Request, Response

from core import exclusions
from core.models import CustomDish
from core.models.enums import RecipeStatus, UserRole
from core.repositories import custom_dishes as dishes_repo
from core.repositories import patients as patients_repo
from core.repositories import products as products_repo
from core.repositories import recipes as recipes_repo
from core.repositories import users as users_repo

from ..deps.auth import CurrentUser, PatientAccessDep, SessionDep
from ..deps.idempotency import IdempotencyKeyDep
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
from ..schemas import CustomDishRead, CustomDishWrite, Page
from ..services import idempotency
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


async def _reject_excluded(
    session: SessionDep, patient_id: uuid.UUID, payload: CustomDishWrite
) -> None:
    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пациент не найден.")
    excluded = await products_repo.same_food_ids(
        session, product_ids=exclusions.excluded_ids(patient.allergies)
    )
    found = exclusions.contains_excluded(
        [item.product_id for item in payload.ingredients], excluded
    )
    if found:
        products = await products_repo.get_by_ids(session, product_ids=found)
        names = ", ".join(products[pid].name_ru for pid in found if pid in products)
        raise ApiError(
            ErrorCode.CONFLICT,
            f"Исключено этому ребёнку: {names}.",
            details={"product_ids": [str(pid) for pid in found]},
        )


def _steps(text: str | None) -> str | None:
    """Steps as stored: blank text is no steps, not an empty section on paper."""

    if text is None:
        return None
    return text.strip() or None


async def _source_recipe_steps(
    session: SessionDep, user: CurrentUser, payload: CustomDishWrite
) -> str | None:
    """Steps the new dish gets (ADR-0088).

    Sent steps win; otherwise the source recipe's are copied. A recipe the
    user cannot read is refused the way the recipes section refuses it — a
    draft hidden from a family is "not found" — so the link cannot be used to
    read a draft's steps.
    """

    if payload.source_recipe_id is None:
        return _steps(payload.instructions)
    recipe = await recipes_repo.get(session, payload.source_recipe_id)
    if recipe is None or (
        user.role is UserRole.PARENT and recipe.status is not RecipeStatus.PUBLISHED
    ):
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Рецепт, из которого собрано блюдо, не найден.",
            details={"source_recipe_id": str(payload.source_recipe_id)},
        )
    if "instructions" in payload.model_fields_set:
        return _steps(payload.instructions)
    return _steps(recipe.instructions)


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
    return Page(items=await _read_many(session, items), total=total)


@router.post("", response_model=CustomDishRead, status_code=201, summary="Сохранить блюдо")
async def create_dish(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: CustomDishWrite,
    session: SessionDep,
    user: PatientAccessDep,
    request: Request,
    idempotency_key: IdempotencyKeyDep,
) -> CustomDishRead:
    # Доступ проверен зависимостью, состав — до брони: отказ 403 или 422 ключ не
    # занимает, и исправленный запрос с тем же ключом пройдёт.
    _reject_duplicates(payload)
    if payload.reject_excluded:
        await _reject_excluded(session, patient_id, payload)
    instructions = await _source_recipe_steps(session, user, payload)
    reservation: uuid.UUID | None = None
    if idempotency_key is not None:
        outcome = await idempotency.begin(
            session,
            user_id=user.id,
            key=idempotency_key,
            fingerprint=idempotency.request_fingerprint(
                request.method, request.url.path, await request.body()
            ),
            patient_id=patient_id,
        )
        if isinstance(outcome, idempotency.Replay):
            return CustomDishRead.model_validate(outcome.body)
        reservation = outcome

    stored, computed, engine_version = await compute_dish(session, ingredients=payload.ingredients)

    dish = await dishes_repo.create(
        session,
        patient_id=patient_id,
        title=payload.title,
        ingredients=stored,
        computed=computed,
        engine_version=engine_version,
        instructions=instructions,
        source_recipe_id=payload.source_recipe_id,
        created_by=user.id,
    )
    created = (await _read_many(session, [dish]))[0]
    if reservation is not None:
        await idempotency.finish(
            session, key_id=reservation, status=201, body=created.model_dump(mode="json")
        )
    return created


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
        instructions=(
            _steps(payload.instructions)
            if "instructions" in payload.model_fields_set
            else dish.instructions
        ),
    )
    return (await _read_many(session, [updated]))[0]


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


async def _read_many(session: SessionDep, dishes: Sequence[CustomDish]) -> list[CustomDishRead]:
    """Блюда с именем и ролью того, кто их сохранил, — одним запросом на всех."""

    authors = await users_repo.get_many(
        session, user_ids={d.created_by for d in dishes if d.created_by is not None}
    )
    result = []
    for dish in dishes:
        author = authors.get(dish.created_by) if dish.created_by is not None else None
        result.append(
            CustomDishRead.model_validate(dish).model_copy(
                update={
                    "created_by_name": None if author is None else author.full_name,
                    "created_by_role": None if author is None else author.role,
                }
            )
        )
    return result
