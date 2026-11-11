"""`/calc` — тонкие обёртки над keto_engine (раздел 5.3 ТЗ).

Ответы включают `engine_version`. `InfeasibleError` отдаётся как
`infeasible_calculation` с человекочитаемой причиной, а не как 500
(раздел 8.3 ТЗ: "infeasible показывается человекочитаемой причиной, не ошибкой").
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from decimal import ROUND_CEILING, Decimal

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from core import exclusions
from core.repositories import patients as patients_repo
from core.repositories import prescriptions as prescriptions_repo
from core.repositories import products as products_repo
from keto_engine import (
    ENGINE_VERSION,
    InfeasibleError,
    energy_requirement,
    fluid_requirement,
    protein_requirement,
    scale,
    solve,
    verify,
    within_tolerance,
)
from keto_engine.constants import MIN_INGREDIENT_GRAMS

from ..deps.auth import CurrentUserDep, SessionDep, assert_patient_access
from ..errors import ApiError, ErrorCode
from ..schemas_calc import (
    CALC_GRAMS_MAX,
    EnergyRequirementRequest,
    EnergyRequirementResponse,
    ExcludedProductOut,
    PrescriptionGoalRequest,
    PrescriptionGoalResponse,
    ScaleRequest,
    ScaleResponse,
    SolveRequest,
    SolveResponse,
    UncountedItemOut,
    UncountedProductOut,
    VerifyRequest,
    VerifyResponse,
)
from ..services import calc as calc_service
from ..services import composition as composition_service

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

    excluded = await products_repo.same_food_ids(
        session, product_ids=exclusions.excluded_ids(patient.allergies)
    )
    found = exclusions.contains_excluded(parsed, excluded)
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


async def _product_names(session: SessionDep, product_ids: Sequence[str]) -> list[str]:
    """Catalogue names for an error message; a free label stands for itself."""

    parsed: dict[str, uuid.UUID] = {}
    for raw in product_ids:
        try:
            parsed[raw] = uuid.UUID(raw)
        except ValueError:
            continue
    products = await products_repo.get_by_ids(session, product_ids=list(parsed.values()))
    return [
        products[parsed[raw]].name_ru if raw in parsed and parsed[raw] in products else raw
        for raw in product_ids
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

    # Приправы (ADR-0054) остаются в составе, но на вход ядра не идут.
    # Исключения выше проверены по ВСЕМУ составу: аллергия на приправу —
    # такая же аллергия.
    uncounted = await composition_service.uncounted_products(
        session, product_ids=[item.product_id for item in payload.items]
    )
    counted, skipped = calc_service.split_items(items, uncounted)

    dish = verify(counted)
    response = VerifyResponse(
        dish=calc_service.to_dish_out(dish), excluded=excluded, uncounted_items=skipped
    )

    if payload.targets is not None:
        ratio_ok, kcal_ok = within_tolerance(dish, calc_service.to_targets(payload.targets))
        response.ratio_within_tolerance = ratio_ok
        response.kcal_within_tolerance = kcal_ok
        # Цели переданы; сравнимо ли соотношение — решает наличие самого
        # соотношения у блюда (#216).
        response.ratio_comparable = ratio_ok is not None
        # Access to the patient was checked by `_excluded_for` above.
        prescription = (
            None
            if payload.patient_id is None
            else await prescriptions_repo.get_active(session, patient_id=payload.patient_id)
        )
        response.meal_goal = calc_service.to_meal_goal(payload.targets, prescription)

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

    # Приправы решатель не подбирает (ADR-0054): в расчёт они не входят, и
    # переменной задачи у них нет. Их масса остаётся той, что ввёл человек, —
    # клиент переносит в состав только массы из `dish.items`.
    uncounted = await composition_service.uncounted_products(
        session, product_ids=list(ingredients.keys())
    )
    skipped = [
        UncountedProductOut(product_id=pid, name_ru=product.name_ru)
        for pid, product in uncounted.items()
    ]
    for pid in uncounted:
        ingredients.pop(pid, None)

    if not ingredients:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "В наборе только приправы, которые не учитываются в расчёте, — подбирать "
            "не из чего. Добавьте продукты, из которых составляется блюдо.",
            details={"uncounted": [entry.product_id for entry in skipped]},
        )

    too_small = calc_service.pins_too_small(targets, ingredients.keys())
    if too_small:
        names = ", ".join(await _product_names(session, too_small))
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Закреплённая масса слишком мала: {names}. "
            f"Укажите не меньше {MIN_INGREDIENT_GRAMS:g} г или снимите закрепление.",
            details={"product_ids": too_small},
        )

    fractional = calc_service.pins_not_whole(targets, ingredients.keys())
    if fractional:
        names = ", ".join(await _product_names(session, fractional))
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Подбор работает в целых граммах, а закреплена дробная масса: {names}. "
            "Округлите её или снимите закрепление.",
            details={"product_ids": fractional},
        )

    # The person chose these products: a dish that silently loses one of them
    # is not the dish that was asked for (ADR-0058).
    keeping_all = calc_service.keeping_every_product(targets, ingredients.keys())
    near = calc_service.near_current(targets, keeping_all, ingredients, payload.current_grams)
    if near is not None:
        try:
            nearby = await run_in_threadpool(solve, list(ingredients.values()), near)
        except InfeasibleError:
            pass
        else:
            return SolveResponse(
                dish=calc_service.to_dish_out(nearby.dish),
                ratio_within_tolerance=nearby.ratio_within_tolerance,
                kcal_within_tolerance=nearby.kcal_within_tolerance,
                excluded=excluded,
                uncounted=skipped,
            )

    try:
        # solve() синхронный и вычислительно тяжёлый (LP через HiGHS, а при
        # неразрешимости ещё несколько LP для диагностики). В event loop он
        # заблокировал бы весь воркер, поэтому уходит в threadpool.
        result = await run_in_threadpool(solve, list(ingredients.values()), keeping_all)
    except InfeasibleError as kept_all_failure:
        # Whether the goal fails at all, or only with every product kept, are
        # different answers: the second one can name what to remove.
        try:
            relaxed = await run_in_threadpool(solve, list(ingredients.values()), targets)
        except InfeasibleError as exc:
            raise ApiError(ErrorCode.INFEASIBLE_CALCULATION, exc.reason) from exc
        dropped = calc_service.missing_from_solution(relaxed.dish, ingredients.keys())
        if not dropped:
            raise ApiError(
                ErrorCode.INFEASIBLE_CALCULATION, kept_all_failure.reason
            ) from kept_all_failure
        names = ", ".join(await _product_names(session, dropped))
        raise ApiError(
            ErrorCode.INFEASIBLE_CALCULATION,
            f"С этими продуктами цель не достигается: {names}. "
            "Уберите их из состава или измените цель.",
            details={"product_ids": dropped},
        ) from kept_all_failure

    return SolveResponse(
        dish=calc_service.to_dish_out(result.dish),
        ratio_within_tolerance=result.ratio_within_tolerance,
        kcal_within_tolerance=result.kcal_within_tolerance,
        excluded=excluded,
        uncounted=skipped,
        reshaped=near is not None,
    )


@router.post(
    "/prescription-goal",
    response_model=PrescriptionGoalResponse,
    summary="Граммы назначения на сутки и на приём",
)
async def prescription_goal(
    payload: PrescriptionGoalRequest, _: CurrentUserDep
) -> PrescriptionGoalResponse:
    return calc_service.to_prescription_goal(payload)


@router.post(
    "/energy-requirement",
    response_model=EnergyRequirementResponse,
    summary="Суточная калорийность по возрасту и весу",
)
async def energy(payload: EnergyRequirementRequest, _: CurrentUserDep) -> EnergyRequirementResponse:
    low, high = energy_requirement(payload.age_years, payload.weight_kg)
    return EnergyRequirementResponse(
        kcal_min=low,
        kcal_max=high,
        kcal_per_kg_min=low / payload.weight_kg,
        kcal_per_kg_max=high / payload.weight_kg,
        protein_g=protein_requirement(payload.weight_kg),
        fluid_ml=fluid_requirement(payload.weight_kg),
        engine_version=ENGINE_VERSION,
    )


@router.post("/scale", response_model=ScaleResponse, summary="Пересчитать блюдо на порцию")
async def scale_dish(
    payload: ScaleRequest, _: CurrentUserDep, session: SessionDep
) -> ScaleResponse:
    ingredients = calc_service.to_ingredients(payload.ingredients)
    try:
        items = calc_service.to_items(ingredients, payload.items)
    except KeyError as exc:
        raise _unknown_product(exc) from exc

    # Пересчёт не должен выдавать массы, которые следующая проверка отклонит:
    # кабинет и Mini App записывают результат прямо в состав и сразу его
    # проверяют. Без этого отказа 3000 г × 2 давали 6000 г, проверка отвечала
    # общим «проверьте поля», а состав был уже переписан.
    heaviest = max(item.grams for item in payload.items) * payload.factor
    if heaviest > CALC_GRAMS_MAX:
        # Сумма для текста — в Decimal от кратчайшей записи чисел и вверх до
        # десятых. Через float шум давал то «7683,1» вместо 7683, то «5000» при
        # превышении в миллиардные доли — «весила бы 5000 г — больше 5000 г».
        exact = Decimal(str(max(item.grams for item in payload.items))) * Decimal(
            str(payload.factor)
        )
        # Граница проверена во float: превышение меньше шага float в Decimal
        # может дать ровно 5000 — текст всё равно обязан быть больше предела.
        tenths = max(
            exact.quantize(Decimal("0.1"), rounding=ROUND_CEILING),
            Decimal(str(CALC_GRAMS_MAX)) + Decimal("0.1"),
        )
        shown = f"{tenths:f}".removesuffix(".0").replace(".", ",")
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"После пересчёта позиция весила бы {shown} г — больше "
            f"{CALC_GRAMS_MAX:g} г, с которыми работает расчёт. Уменьшите коэффициент порции.",
            details={"max_grams": CALC_GRAMS_MAX},
        )

    # Приправа масштабируется вместе с порцией, но мимо ядра (ADR-0054): её
    # масса умножается на коэффициент, а в показатели блюда она не входит.
    uncounted = await composition_service.uncounted_products(
        session, product_ids=[item.product_id for item in payload.items]
    )
    counted, skipped = calc_service.split_items(items, uncounted)

    scaled = scale(verify(counted), payload.factor)
    return ScaleResponse(
        dish=calc_service.to_dish_out(scaled),
        uncounted_items=[
            UncountedItemOut(
                product_id=entry.product_id,
                name_ru=entry.name_ru,
                grams=entry.grams * payload.factor,
            )
            for entry in skipped
        ],
    )
