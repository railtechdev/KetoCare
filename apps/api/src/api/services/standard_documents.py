"""Load the 2025 kindergarten documents as a locked, non-ketogenic standard (ADR-0060).

Everything loaded stays a draft and visible to specialists only: this is food
for healthy children, not a menu for a child on the diet.
"""

from __future__ import annotations

import csv
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import (
    DEFAULT_FOOD_STANDARD_ID,
    FoodStandard,
    MenuTemplate,
    MenuTemplateItem,
    Product,
    ProductCategory,
    Recipe,
    RecipeIngredient,
)
from core.models.enums import (
    CarbsConvention,
    FoodDietType,
    FoodStandardKind,
    RecipeCategory,
    RecipeStatus,
)
from core.repositories import audit as audit_repo
from core.repositories import food_standards as food_standards_repo
from core.repositories import products as products_repo

from . import composition as composition_service

STANDARD_NAME = "Единое сезонное меню ДОУ, 2025"

MEAL_INDEX = {"breakfast": 1, "second_lunch": 2, "lunch": 3, "dinner": 4}
CATEGORY = {
    "breakfast": RecipeCategory.BREAKFAST,
    "second_lunch": RecipeCategory.SNACK,
    "lunch": RecipeCategory.LUNCH,
    "dinner": RecipeCategory.DINNER,
}
SEASON = {
    "bahor": "весна",
    "yoz": "лето",
    "kuz": "осень",
    "qish": "зима",
    "all": "круглый год",
}


class DocumentLoadError(Exception):
    """The load cannot be done honestly; nothing is written."""


class AlreadyLoadedError(DocumentLoadError):
    """The standard is already in the database."""


@dataclass
class LoadReport:
    products: int = 0
    linked_to_catalogue: int = 0
    recipes: int = 0
    templates: int = 0
    items_with_recipe: int = 0
    items_without_recipe: int = 0
    notes: list[str] = field(default_factory=list)


def _read(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


async def _catalogue_food_ids(
    session: AsyncSession, mapping: dict[str, str], *, require_all: bool
) -> tuple[dict[str, uuid.UUID], list[str]]:
    wanted = {name for name in mapping.values() if name}
    rows = await session.execute(
        select(Product.name_ru, Product.food_id).where(
            Product.standard_id == DEFAULT_FOOD_STANDARD_ID, Product.name_ru.in_(wanted)
        )
    )
    found: dict[str, uuid.UUID] = {name: food_id for name, food_id in rows}
    missing = sorted(wanted - found.keys())
    if missing and require_all:
        # A missed link means a child's exclusion would not reach this product.
        raise DocumentLoadError(f"В основном справочнике нет продуктов: {', '.join(missing)}")
    return found, missing


async def load(
    session: AsyncSession, *, data_dir: Path, author_id: uuid.UUID, require_all_links: bool = True
) -> LoadReport:
    """Create the standard, its products, draft recipes and templates, then lock it.

    `require_all_links=False` loads a standard even if some catalogue products
    are absent; those links are reported. It is safe only while nothing of this
    standard can reach a child's plan, which is true until stage 5.
    """

    if await food_standards_repo.find_by_name(session, name=STANDARD_NAME) is not None:
        raise AlreadyLoadedError("Стандарт уже загружен.")

    products_csv = _read(data_dir / "products.csv")
    mapping = {
        row["name_ru"]: row["catalog_name_ru"] for row in _read(data_dir / "name_mapping.csv")
    }
    unmapped = sorted({row["name_ru"] for row in products_csv} - mapping.keys())
    if unmapped:
        raise DocumentLoadError(f"Нет строки соответствия: {', '.join(unmapped)}")
    food_ids, unlinked = await _catalogue_food_ids(session, mapping, require_all=require_all_links)

    names = {row["key"]: row for row in _read(data_dir / "product_names.csv")}
    dishes = {row["raw"]: row for row in _read(data_dir / "dish_names.csv")}
    categories = {
        category.name_ru: category for category in await session.scalars(select(ProductCategory))
    }

    report = LoadReport(notes=[f"Нет в основном справочнике: {name}" for name in unlinked])
    standard = FoodStandard(
        name=STANDARD_NAME,
        publisher="Министерство дошкольного и школьного образования, Минздрав",
        document="Yagona mavsumiy taomnoma, SanQvaM 0016-21",
        version="2025",
        kind=FoodStandardKind.REFERENCE,
        diet_type=FoodDietType.GENERAL,
        carbs_convention=CarbsConvention.UNKNOWN,
    )
    session.add(standard)
    await session.flush()

    by_name: dict[str, Product] = {}
    for row in products_csv:
        category = categories.get(row["category"])
        if category is None:
            category = ProductCategory(name_ru=row["category"], sort=100)
            session.add(category)
            await session.flush()
            categories[row["category"]] = category
        target = mapping[row["name_ru"]]
        extra = {"food_id": food_ids[target]} if target in food_ids else {}
        product = await products_repo.create(
            session,
            changed_by=author_id,
            standard_id=standard.id,
            name_ru=row["name_ru"],
            name_uz=row["name_uz"] or None,
            category_id=category.id,
            kcal_100g=float(row["kcal_100g"]),
            fat_100g=float(row["fat_100g"]),
            protein_100g=float(row["protein_100g"]),
            carbs_100g=float(row["carbs_100g"]),
            fiber_100g=float(row["fiber_100g"]),
            source=row["source"],
            source_version=row["source_version"],
            verified_at=date.fromisoformat(row["verified_at"]),
            counts_in_calculation=row["counts_in_calculation"] == "да",
            **extra,
        )
        by_name[row["name_ru"]] = product
        report.products += 1
        report.linked_to_catalogue += 1 if target in food_ids else 0

    # Rows of one dish instance, in the document's order.
    instances: dict[tuple[str, str, int, str, str], list[dict[str, str]]] = defaultdict(list)
    for row in _read(data_dir / "source_rows.csv"):
        if row["meal"] in MEAL_INDEX and row["dish"]:
            key = (row["doc"], row["season"], int(row["day"]), row["meal"], row["dish"])
            instances[key].append(row)

    templates: dict[tuple[str, str], MenuTemplate] = {}
    positions: dict[tuple[uuid.UUID, int, int], int] = defaultdict(int)
    recipes: dict[tuple[str, tuple[tuple[str, float], ...]], Recipe] = {}

    for (doc, season, day, meal, raw), rows in instances.items():
        template = templates.get((doc, season))
        if template is None:
            cycle = max(key[2] for key in instances if key[0] == doc and key[1] == season)
            template = MenuTemplate(
                standard_id=standard.id,
                title=f"Детский сад, {doc} ч, {SEASON[season]}",
                season=SEASON[season],
                cycle_days=cycle,
                status=RecipeStatus.DRAFT,
                source_ref=f"Yagona mavsumiy taomnoma, {doc} soat",
            )
            session.add(template)
            await session.flush()
            templates[(doc, season)] = template
            report.templates += 1

        dish = dishes[raw]
        glued = dish["glued"] == "1"
        title = dish["title"] if not glued else raw

        parts: list[tuple[Product, float]] = []
        complete = not glued
        for row in rows:
            accepted = by_name.get(names[row["product_key"]]["name_ru"])
            grams = float(row["gross_g"] or 0)
            if accepted is None or grams <= 0:
                complete = False
                break
            parts.append((accepted, grams))

        # One product twice inside a dish means the document's dish boundary
        # was not resolved, so the dish does not get numbers.
        if len({product.id for product, _ in parts}) != len(parts):
            complete = False

        recipe: Recipe | None = None
        if complete:
            key_parts = tuple(sorted((str(product.id), grams) for product, grams in parts))
            recipe = recipes.get((title, key_parts))
            if recipe is None:
                counted, _uncounted = composition_service.split(parts)
                computed: dict[str, object] | None = None
                engine_version: str | None = None
                if counted:
                    computed, engine_version = await composition_service.compute(
                        session, composition=[(product.id, grams) for product, grams in parts]
                    )
                recipe = Recipe(
                    title=title,
                    category=CATEGORY[meal],
                    yield_g=sum(grams for _, grams in parts),
                    servings=1,
                    instructions="",
                    status=RecipeStatus.DRAFT,
                    computed=computed,
                    engine_version=engine_version,
                    author_id=author_id,
                    standard_id=standard.id,
                    source_ref=f"{doc} soat, стр. {rows[0]['page']}",
                )
                session.add(recipe)
                await session.flush()
                for position, (product, grams) in enumerate(parts):
                    session.add(
                        RecipeIngredient(
                            recipe_id=recipe.id,
                            product_id=product.id,
                            grams=grams,
                            position=position,
                        )
                    )
                recipes[(title, key_parts)] = recipe
                report.recipes += 1

        slot = (template.id, day, MEAL_INDEX[meal])
        session.add(
            MenuTemplateItem(
                template_id=template.id,
                cycle_day=day,
                meal_index=MEAL_INDEX[meal],
                position=positions[slot],
                dish_title=title[:255],
                recipe_id=None if recipe is None else recipe.id,
            )
        )
        positions[slot] += 1
        if recipe is None:
            report.items_without_recipe += 1
        else:
            report.items_with_recipe += 1

    await session.flush()
    await food_standards_repo.lock(session, standard=standard)
    # The same two actions as a standard created and locked by hand, so the
    # journal's filter finds this one too.
    await audit_repo.write_audit_log(
        session,
        user_id=author_id,
        action="create",
        entity="food_standards",
        entity_id=standard.id,
        after={
            "document": standard.document,
            "products": report.products,
            "recipes": report.recipes,
            "templates": report.templates,
            "unlinked": unlinked,
        },
    )
    await audit_repo.write_audit_log(
        session,
        user_id=author_id,
        action="lock",
        entity="food_standards",
        entity_id=standard.id,
    )
    return report
