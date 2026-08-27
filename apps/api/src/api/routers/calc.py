"""`/calc` — тонкие обёртки над keto_engine (раздел 5.3 ТЗ).

Ответы включают `engine_version`. `InfeasibleError` отдаётся как
`infeasible_calculation` с человекочитаемой причиной, а не как 500
(раздел 8.3 ТЗ: "infeasible показывается человекочитаемой причиной, не ошибкой").
"""

from __future__ import annotations

from fastapi import APIRouter

from keto_engine import InfeasibleError, scale, solve, verify, within_tolerance

from ..deps.auth import CurrentUserDep
from ..errors import ApiError, ErrorCode
from ..schemas_calc import (
    ScaleRequest,
    ScaleResponse,
    SolveRequest,
    SolveResponse,
    VerifyRequest,
    VerifyResponse,
)
from ..services import calc as calc_service

router = APIRouter(prefix="/calc", tags=["calc"])


def _unknown_product(exc: KeyError) -> ApiError:
    return ApiError(
        ErrorCode.VALIDATION_ERROR,
        "В составе указан продукт, отсутствующий в списке ingredients.",
        details={"product_id": str(exc.args[0]) if exc.args else None},
    )


@router.post("/verify", response_model=VerifyResponse, summary="Проверить блюдо по составу")
async def verify_dish(payload: VerifyRequest, _: CurrentUserDep) -> VerifyResponse:
    ingredients = calc_service.to_ingredients(payload.ingredients)
    try:
        items = calc_service.to_items(ingredients, payload.items)
    except KeyError as exc:
        raise _unknown_product(exc) from exc

    dish = verify(items)
    response = VerifyResponse(dish=calc_service.to_dish_out(dish))

    if payload.targets is not None:
        ratio_ok, kcal_ok = within_tolerance(dish, calc_service.to_targets(payload.targets))
        response.ratio_within_tolerance = ratio_ok
        response.kcal_within_tolerance = kcal_ok

    return response


@router.post("/solve", response_model=SolveResponse, summary="Подобрать массы под цели")
async def solve_dish(payload: SolveRequest, _: CurrentUserDep) -> SolveResponse:
    ingredients = calc_service.to_ingredients(payload.ingredients)
    targets = calc_service.to_targets(payload.targets)

    try:
        result = solve(list(ingredients.values()), targets)
    except InfeasibleError as exc:
        raise ApiError(ErrorCode.INFEASIBLE_CALCULATION, exc.reason) from exc

    return SolveResponse(
        dish=calc_service.to_dish_out(result.dish),
        ratio_within_tolerance=result.ratio_within_tolerance,
        kcal_within_tolerance=result.kcal_within_tolerance,
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
