"""`/calc` — тонкие обёртки над keto_engine (раздел 5.3 ТЗ).

Ответы включают `engine_version`. `InfeasibleError` отдаётся как
`infeasible_calculation` с человекочитаемой причиной, а не как 500
(раздел 8.3 ТЗ: "infeasible показывается человекочитаемой причиной, не ошибкой").
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from core import exclusions
from core.repositories import patients as patients_repo
from core.repositories import products as products_repo
from keto_engine import InfeasibleError, scale, solve, verify, within_tolerance

from ..deps.auth import CurrentUserDep, SessionDep, assert_patient_access
from ..errors import ApiError, ErrorCode
from ..schemas_calc import (
    ExcludedProductOut,
    ScaleRequest,
    ScaleResponse,
    SolveRequest,
    SolveResponse,
    VerifyRequest,
    VerifyResponse,
)
from ..services import calc as calc_service

router = APIRouter(prefix="/calc", tags=["calc"])


async def _excluded_for(
    session: SessionDep,
    user: CurrentUserDep,
    patient_id: uuid.UUID | None,
    product_ids: Sequence[str],
) -> list[ExcludedProductOut]:
    """Какие из перечисленных продуктов исключены этому ребёнку.

    Раздел 6.3 ТЗ требует, чтобы исключённые продукты не попадали на вход
    решателя, и оставляет фильтрацию «вызывающей стороне». Вызывающей стороны
    не существовало: `/calc` не знал пациента вовсе. Теперь знает — и проверяет
    доступ к нему так же, как любая ручка с данными пациента.

    Названия берутся из каталога: «product_id: 3f2a…» человеку ничего не
    говорит, а список исключённого он читает в тот момент, когда решает,
    кормить этим ребёнка или нет.
    """

    if patient_id is None:
        return []

    await assert_patient_access(session, user, patient_id)

    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пациент не найден.")

    parsed: list[uuid.UUID] = []
    for raw in product_ids:
        try:
            parsed.append(uuid.UUID(raw))
        except ValueError:
            # Идентификатор не из каталога — сопоставить его с исключением
            # нечем, и притворяться, что сопоставили, нельзя.
            continue

    found = exclusions.contains_excluded(parsed, patient.allergies)
    if not found:
        return []

    products = await products_repo.get_by_ids(session, product_ids=found)
    return [
        ExcludedProductOut(
            product_id=str(pid),
            name_ru=products[pid].name_ru if pid in products else None,
        )
        for pid in found
    ]


def _unknown_product(exc: KeyError) -> ApiError:
    return ApiError(
        ErrorCode.VALIDATION_ERROR,
        "В составе указан продукт, отсутствующий в списке ingredients.",
        details={"product_id": str(exc.args[0]) if exc.args else None},
    )


@router.post("/verify", response_model=VerifyResponse, summary="Проверить блюдо по составу")
async def verify_dish(
    payload: VerifyRequest, user: CurrentUserDep, session: SessionDep
) -> VerifyResponse:
    ingredients = calc_service.to_ingredients(payload.ingredients)
    try:
        items = calc_service.to_items(ingredients, payload.items)
    except KeyError as exc:
        raise _unknown_product(exc) from exc

    # Состав задал человек, и подменять его молча нельзя: проверка считает как
    # есть и отдельно говорит, что в нём исключено ребёнку.
    excluded = await _excluded_for(
        session, user, payload.patient_id, [item.product_id for item in payload.items]
    )

    dish = verify(items)
    response = VerifyResponse(dish=calc_service.to_dish_out(dish), excluded=excluded)

    if payload.targets is not None:
        ratio_ok, kcal_ok = within_tolerance(dish, calc_service.to_targets(payload.targets))
        response.ratio_within_tolerance = ratio_ok
        response.kcal_within_tolerance = kcal_ok

    return response


@router.post("/solve", response_model=SolveResponse, summary="Подобрать массы под цели")
async def solve_dish(
    payload: SolveRequest, user: CurrentUserDep, session: SessionDep
) -> SolveResponse:
    ingredients = calc_service.to_ingredients(payload.ingredients)
    targets = calc_service.to_targets(payload.targets)

    # Подбор САМ выбирает, из чего составить блюдо, поэтому исключённые
    # продукты не предупреждением снимаются, а вычёркиваются со входа: иначе
    # решателю позволено предложить их ребёнку (раздел 6.3 ТЗ).
    excluded = await _excluded_for(session, user, payload.patient_id, list(ingredients.keys()))
    for entry in excluded:
        ingredients.pop(entry.product_id, None)

    if not ingredients:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Все продукты набора исключены этому ребёнку — подбирать не из чего.",
            details={"excluded": [entry.product_id for entry in excluded]},
        )

    try:
        # solve() синхронный и вычислительно тяжёлый (LP через HiGHS, а при
        # неразрешимости ещё несколько LP для диагностики). В event loop он
        # заблокировал бы весь воркер, поэтому уходит в threadpool.
        result = await run_in_threadpool(solve, list(ingredients.values()), targets)
    except InfeasibleError as exc:
        raise ApiError(ErrorCode.INFEASIBLE_CALCULATION, exc.reason) from exc

    return SolveResponse(
        dish=calc_service.to_dish_out(result.dish),
        ratio_within_tolerance=result.ratio_within_tolerance,
        kcal_within_tolerance=result.kcal_within_tolerance,
        excluded=excluded,
    )


@router.post("/scale", response_model=ScaleResponse, summary="Пересчитать блюдо на порцию")
async def scale_dish(payload: ScaleRequest, _: CurrentUserDep) -> ScaleResponse:
    ingredients = calc_service.to_ingredients(payload.ingredients)
    try:
        items = calc_service.to_items(ingredients, payload.items)
    except KeyError as exc:
        raise _unknown_product(exc) from exc

    scaled = scale(verify(items), payload.factor)
    return ScaleResponse(dish=calc_service.to_dish_out(scaled))
