"""`/patients/{patient_id}/recipe-fits`: library recipes fitted to a child (ADR-0059).

Nothing is saved here. The specialist reviews the proposals and saves the
chosen ones through `POST /custom-dishes`, the usual write path.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path

from core import exclusions
from core.models import Product, Recipe
from core.models.enums import RecipeStatus, UserRole
from core.repositories import patients as patients_repo
from core.repositories import prescriptions as prescriptions_repo
from core.repositories import products as products_repo
from core.repositories import recipes as recipes_repo
from keto_engine import ENGINE_VERSION, Targets

from ..deps.auth import CurrentUser, PatientAccessDep, SessionDep, require_roles
from ..errors import ApiError, ErrorCode
from ..schemas import (
    RecipeFit,
    RecipeFitDish,
    RecipeFitIngredient,
    RecipeFitsRequest,
    RecipeFitsResponse,
)
from ..services import dish_fit

router = APIRouter(prefix="/patients/{patient_id}/recipe-fits", tags=["custom-dishes"])

SpecialistDep = Annotated[CurrentUser, Depends(require_roles(UserRole.DOCTOR, UserRole.DIETITIAN))]


async def _fit_one(
    recipe: Recipe,
    composition: list[tuple[uuid.UUID, float]],
    products: dict[uuid.UUID, Product],
    excluded: set[uuid.UUID],
    targets: Targets,
) -> RecipeFit:
    names = [products[pid].name_ru for pid, _ in composition if pid in excluded]
    if names:
        return RecipeFit(
            recipe_id=recipe.id,
            title=recipe.title,
            status="excluded",
            reason=f"Исключено этому ребёнку: {', '.join(names)}.",
        )
    withdrawn = [products[pid].name_ru for pid, _ in composition if not products[pid].is_active]

    outcome, uncounted = await dish_fit.fit_composition(products, composition, targets)
    if isinstance(outcome, dish_fit.FitFailure):
        return RecipeFit(
            recipe_id=recipe.id,
            title=recipe.title,
            status="infeasible",
            reason=outcome.reason,
            withdrawn=withdrawn,
        )

    solved = outcome.result
    grams = {item.ingredient.product_id: item.grams for item in solved.dish.items}
    seasoning = {item.product_id: item.grams for item in uncounted}
    lost = [
        products[pid].name_ru
        for pid, _ in composition
        if pid not in seasoning and str(pid) not in grams
    ]
    if lost:
        return RecipeFit(
            recipe_id=recipe.id,
            title=recipe.title,
            status="infeasible",
            reason=f"Подбор не сохранил в составе: {', '.join(lost)}.",
        )
    return RecipeFit(
        recipe_id=recipe.id,
        title=recipe.title,
        status="fitted",
        reshaped=outcome.reshaped,
        withdrawn=withdrawn,
        ingredients=[
            RecipeFitIngredient(
                product_id=pid,
                name_ru=products[pid].name_ru,
                # Seasonings are not solved and keep the recipe's mass.
                grams=seasoning[pid] if pid in seasoning else grams[str(pid)],
            )
            for pid, _ in composition
        ],
        dish=RecipeFitDish(
            kcal=solved.dish.kcal,
            fat_g=solved.dish.fat_g,
            protein_g=solved.dish.protein_g,
            carbs_g=solved.dish.carbs_g,
            fiber_g=solved.dish.fiber_g,
            ratio=solved.dish.ratio,
        ),
        ratio_within_tolerance=solved.ratio_within_tolerance,
        kcal_within_tolerance=solved.kcal_within_tolerance,
    )


@router.post("", response_model=RecipeFitsResponse, summary="Подогнать рецепты под ребёнка")
async def fit_recipes(
    patient_id: Annotated[uuid.UUID, Path()],
    payload: RecipeFitsRequest,
    session: SessionDep,
    _access: PatientAccessDep,
    _role: SpecialistDep,
) -> RecipeFitsResponse:
    prescription = await prescriptions_repo.get_active(session, patient_id=patient_id)
    if prescription is None:
        raise ApiError(
            ErrorCode.CONFLICT, "Сначала задайте назначение: подгонять рецепты не под что."
        )
    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пациент не найден.")

    targets = dish_fit.meal_targets(prescription)
    excluded = await products_repo.same_food_ids(
        session, product_ids=exclusions.excluded_ids(patient.allergies)
    )
    ingredients_by_recipe = await recipes_repo.ingredients_by_recipe(
        session, recipe_ids=payload.recipe_ids
    )
    product_ids = list({row.product_id for rows in ingredients_by_recipe.values() for row in rows})
    products = await products_repo.get_by_ids(session, product_ids=product_ids)

    items: list[RecipeFit] = []
    for recipe_id in dict.fromkeys(payload.recipe_ids):
        recipe = await recipes_repo.get(session, recipe_id)
        # A draft is unfinished work of the dietitian, and a child is not fed by it.
        if recipe is None or recipe.status is not RecipeStatus.PUBLISHED:
            items.append(
                RecipeFit(
                    recipe_id=recipe_id,
                    title=recipe.title if recipe is not None else "",
                    status="unavailable",
                    reason="Рецепт не опубликован.",
                )
            )
            continue
        composition = [
            (row.product_id, float(row.grams)) for row in ingredients_by_recipe.get(recipe_id, [])
        ]
        if not composition:
            items.append(
                RecipeFit(
                    recipe_id=recipe_id,
                    title=recipe.title,
                    status="unavailable",
                    reason="В рецепте нет состава.",
                )
            )
            continue
        items.append(await _fit_one(recipe, composition, products, excluded, targets))

    return RecipeFitsResponse(
        target_ratio=targets.ratio,
        target_kcal=targets.kcal,
        engine_version=ENGINE_VERSION,
        items=items,
    )
