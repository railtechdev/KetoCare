"""A recipe file under review: what the reviewer sees and what she may decide (ADR-0079).

The draft document itself is described in `core.recipe_import`; this module
reads it against the catalogue. Nothing about a name is stored as "matched":
whether a name has a product is worked out on every read from the reviewer's
decisions, the remembered aliases and the catalogue as it is now. A product
archived after the file was read stops matching by itself, and a product added
from the review table starts matching without a second action.

A name gets a product **without a question** in two cases only: the catalogue
has a product of exactly that name, or a specialist matched this spelling
before. Everything found by search is a suggestion and waits for a click — the
difference between "сливки 10 %" and "сливки 33 %" is the ketogenic ratio.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core import recipe_import as shape
from core.models import DEFAULT_FOOD_STANDARD_ID, Product, RecipeImportDraft
from core.models.enums import RecipeCategory
from core.repositories import product_aliases as aliases_repo
from core.repositories import products as products_repo
from core.repositories import recipe_import_drafts as drafts_repo
from core.repositories import recipes as recipes_repo
from keto_engine import ENGINE_VERSION, verify

from ..errors import ApiError, ErrorCode
from ..schemas_recipe_import import (
    ImportLine,
    ImportName,
    ImportProduct,
    ImportRecipe,
    LineEdit,
    LineState,
    MatchSource,
    NameDecision,
    RecipeEdit,
    RecipeImportSummary,
    RecipeImportView,
    RecipeProblem,
)
from ..schemas_recipes import MAX_INGREDIENTS
from . import composition as composition_service
from .recipe_import import INSTRUCTIONS_MAX, match_key

#: Parsing that has not written anything for this long is offered to continue.
#: One part of a file may take two model calls of up to 150 seconds each.
STALL_AFTER = timedelta(minutes=8)

#: Label of the lines kept in the text and out of the calculation.
LEFT_OUT_LABEL = "Без взвешивания"

_PENDING: frozenset[LineState] = frozenset({"no_product", "no_grams", "unconfirmed"})


def usable(product: Product | None) -> bool:
    """Whether a new recipe may stand on this product.

    The working catalogue only, and only live entries: an archived product was
    retired on purpose, and a reference-standard entry may lack fat, protein or
    carbohydrate altogether (ADR-0067).
    """

    return (
        product is not None
        and product.is_active
        and product.standard_id == DEFAULT_FOOD_STANDARD_ID
        and not composition_service.unknown_energy(product)
    )


@dataclass(slots=True)
class _Catalogue:
    """Everything about the catalogue one read of the draft needs, loaded once."""

    #: name key → (product, how it was matched) for names that have a product.
    matched: dict[str, tuple[Product, MatchSource]] = field(default_factory=dict)
    left_out: set[str] = field(default_factory=set)
    products: dict[uuid.UUID, Product] = field(default_factory=dict)
    titles_taken: set[str] = field(default_factory=set)


async def _catalogue(session: AsyncSession, payload: dict[str, Any]) -> _Catalogue:
    names: dict[str, str] = {}
    for recipe in payload["recipes"]:
        for line in recipe["lines"]:
            names.setdefault(aliases_repo.alias_key(line["name"]), line["name"])
    names.pop("", None)

    resolutions: dict[str, dict[str, Any]] = payload["resolutions"]
    aliases = await aliases_repo.get_many(session, keys=names)
    by_name = await products_repo.get_by_names(session, names=list(names.values()))

    wanted: set[uuid.UUID] = set(aliases.values())
    for made in resolutions.values():
        if made.get("product_id"):
            wanted.add(uuid.UUID(made["product_id"]))
    for ids in payload["candidates"].values():
        wanted.update(uuid.UUID(product_id) for product_id in ids)

    catalogue = _Catalogue(
        products=await products_repo.get_by_ids(session, product_ids=list(wanted))
    )
    for product in by_name.values():
        catalogue.products.setdefault(product.id, product)

    for key, name in names.items():
        decision = resolutions.get(key)
        if decision is not None and decision.get("left_out"):
            catalogue.left_out.add(key)
            continue

        chosen: tuple[Product | None, MatchSource] | None = None
        if decision is not None and decision.get("product_id"):
            chosen = (catalogue.products.get(uuid.UUID(decision["product_id"])), "manual")
        elif key in aliases:
            chosen = (catalogue.products.get(aliases[key]), "alias")
        else:
            exact = by_name.get(match_key(name))
            if exact is not None:
                chosen = (exact, "exact")

        if chosen is not None and usable(chosen[0]):
            assert chosen[0] is not None
            catalogue.matched[key] = (chosen[0], chosen[1])

    open_titles = [
        recipe["title"] for recipe in payload["recipes"] if recipe["state"] == shape.OPEN
    ]
    catalogue.titles_taken = await recipes_repo.titles_taken(session, titles=open_titles)
    return catalogue


def _product(product: Product) -> ImportProduct:
    return ImportProduct(
        id=product.id,
        name_ru=product.name_ru,
        counts_in_calculation=composition_service.counts_in_calculation(product),
    )


def _line_state(line: dict[str, Any], key: str, catalogue: _Catalogue) -> LineState:
    if line["left_out"] or key in catalogue.left_out:
        return "left_out"
    match = catalogue.matched.get(key)
    if match is None:
        return "no_product"
    if line["grams"] is None:
        # A seasoning needs no mass: it is not in the calculation (ADR-0054),
        # and "salt to taste" is exactly how it is written.
        if not composition_service.counts_in_calculation(match[0]):
            return "left_out"
        return "no_grams"
    if not line["grounded"] and not line["confirmed"]:
        return "unconfirmed"
    return "ok"


@dataclass(slots=True)
class _Reading:
    """One recipe of the draft read against the catalogue."""

    recipe: dict[str, Any]
    states: list[LineState]
    #: Products and masses that go into the calculation, repeats summed.
    composition: list[tuple[uuid.UUID, float]]
    problems: list[RecipeProblem]
    computed: dict[str, Any] | None

    @property
    def ready(self) -> bool:
        return self.recipe["state"] == shape.OPEN and not self.problems


def _read_recipe(
    recipe: dict[str, Any], catalogue: _Catalogue, earlier_titles: set[str]
) -> _Reading:
    keys = [aliases_repo.alias_key(line["name"]) for line in recipe["lines"]]
    states = [
        _line_state(line, key, catalogue) for line, key in zip(recipe["lines"], keys, strict=True)
    ]

    # The same product written twice ("oil for the pan", "oil for the dough")
    # is one ingredient of the dish; a recipe may not hold a product twice.
    masses: dict[uuid.UUID, float] = {}
    for line, key, state in zip(recipe["lines"], keys, states, strict=True):
        if state == "ok":
            product_id = catalogue.matched[key][0].id
            masses[product_id] = round(masses.get(product_id, 0.0) + float(line["grams"]), 1)
    composition = list(masses.items())

    pending = any(state in _PENDING for state in states)
    counted, _ = composition_service.split(
        (catalogue.products[product_id], grams) for product_id, grams in composition
    )

    problems: list[RecipeProblem] = []
    title_key = match_key(recipe["title"])
    if not title_key:
        problems.append("title")
    elif title_key in catalogue.titles_taken or title_key in earlier_titles:
        problems.append("title_taken")
    if recipe["category"] is None:
        problems.append("category")
    if pending:
        problems.append("lines")
    elif not counted:
        problems.append("empty")
    if len(composition) > MAX_INGREDIENTS:
        problems.append("too_many")

    computed: dict[str, Any] | None = None
    if counted and not pending:
        computed = composition_service.totals_of(verify(counted))
        computed["uncounted_product_ids"] = [
            str(product_id)
            for product_id, _ in composition
            if not composition_service.counts_in_calculation(catalogue.products[product_id])
        ]

    return _Reading(
        recipe=recipe, states=states, composition=composition, problems=problems, computed=computed
    )


def _read_all(payload: dict[str, Any], catalogue: _Catalogue) -> list[_Reading]:
    readings: list[_Reading] = []
    earlier: set[str] = set()
    for recipe in payload["recipes"]:
        reading = _read_recipe(recipe, catalogue, earlier)
        readings.append(reading)
        if recipe["state"] == shape.OPEN:
            earlier.add(match_key(recipe["title"]))
    return readings


def summary(draft: RecipeImportDraft) -> RecipeImportSummary:
    recipes = draft.payload["recipes"]
    return RecipeImportSummary(
        id=draft.id,
        file_name=draft.file_name,
        status=draft.status,  # type: ignore[arg-type]
        created_at=draft.created_at,
        lines_total=len(draft.source_lines),
        lines_done=draft.lines_done,
        recipes=len(recipes),
        imported=sum(1 for recipe in recipes if recipe["state"] == shape.IMPORTED),
    )


async def view(session: AsyncSession, draft: RecipeImportDraft) -> RecipeImportView:
    payload = draft.payload
    catalogue = await _catalogue(session, payload)
    readings = _read_all(payload, catalogue)

    # The names table covers open recipes only: a skipped or imported recipe
    # asks nothing of the reviewer any more.
    counts: dict[str, int] = {}
    first: dict[str, dict[str, Any]] = {}
    for recipe in payload["recipes"]:
        if recipe["state"] != shape.OPEN:
            continue
        for key in {aliases_repo.alias_key(line["name"]) for line in recipe["lines"]}:
            counts[key] = counts.get(key, 0) + 1
        for line in recipe["lines"]:
            first.setdefault(aliases_repo.alias_key(line["name"]), line)

    names: list[ImportName] = []
    for key, line in first.items():
        if not key:
            continue
        match = catalogue.matched.get(key)
        candidates = [
            _product(catalogue.products[uuid.UUID(product_id)])
            for product_id in payload["candidates"].get(key, [])
            if usable(catalogue.products.get(uuid.UUID(product_id)))
            and (match is None or match[0].id != uuid.UUID(product_id))
        ]
        names.append(
            ImportName(
                key=key,
                name=line["name"],
                hint=line["hint"],
                recipes=counts[key],
                state=(
                    "left_out"
                    if key in catalogue.left_out
                    else "matched"
                    if match is not None
                    else "unresolved"
                ),
                source=match[1] if match is not None else None,
                product=_product(match[0]) if match is not None else None,
                candidates=candidates,
            )
        )

    items: list[ImportRecipe] = []
    for reading in readings:
        recipe = reading.recipe
        lines = []
        for index, (line, state) in enumerate(zip(recipe["lines"], reading.states, strict=True)):
            key = aliases_repo.alias_key(line["name"])
            match = catalogue.matched.get(key)
            lines.append(
                ImportLine(
                    index=index,
                    source=shape.source_line(draft.source_lines, line["line"]),
                    name=line["name"],
                    key=key,
                    grams=line["grams"],
                    state=state,
                    product_name=match[0].name_ru if match is not None else None,
                )
            )
        state = recipe["state"]
        items.append(
            ImportRecipe(
                id=recipe["id"],
                title=recipe["title"],
                category=RecipeCategory(recipe["category"]) if recipe["category"] else None,
                servings=recipe["servings"],
                yield_g=recipe["yield_g"],
                instructions=recipe["instructions"],
                state=(
                    state
                    if state != shape.OPEN
                    else "ready"
                    if not reading.problems
                    else "needs_work"
                ),
                problems=reading.problems if state == shape.OPEN else [],
                recipe_id=uuid.UUID(recipe["recipe_id"]) if recipe["recipe_id"] else None,
                kcal=reading.computed.get("kcal") if reading.computed else None,
                ratio=reading.computed.get("ratio") if reading.computed else None,
                lines=lines,
            )
        )

    base = summary(draft)
    stalled = (
        draft.status == drafts_repo.PARSING and datetime.now(UTC) - draft.updated_at > STALL_AFTER
    )
    return RecipeImportView(
        **base.model_dump(),
        failure=draft.failure,
        stalled=stalled,
        notes=list(payload["notes"]),
        names=names,
        items=items,
        ready=sum(1 for reading in readings if reading.ready),
    )


async def decide_name(
    session: AsyncSession,
    *,
    draft: RecipeImportDraft,
    decision: NameDecision,
    user_id: uuid.UUID,
) -> None:
    """Save what the reviewer decided about a name; a product choice is remembered.

    The choice is stored twice on purpose. In the draft it wins over everything
    else for this file. As an alias it answers the same spelling in every later
    file — for every specialist, which is the point: the catalogue is shared.
    """

    key = aliases_repo.alias_key(decision.key)
    if key not in shape.name_keys(draft.payload):
        raise ApiError(ErrorCode.NOT_FOUND, "Такого названия в файле нет.")

    resolutions: dict[str, Any] = draft.payload["resolutions"]
    if decision.product_id is not None:
        product = await products_repo.get(session, decision.product_id)
        if not usable(product):
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                "Этот продукт нельзя поставить в рецепт: его нет в рабочем "
                "справочнике, он выведен из него или в нём не хватает данных.",
            )
        resolutions[key] = {"product_id": str(decision.product_id)}
        await aliases_repo.remember(
            session, key=key, product_id=decision.product_id, created_by=user_id
        )
    elif decision.left_out:
        resolutions[key] = {"left_out": True}
    else:
        resolutions.pop(key, None)
    drafts_repo.touch_payload(draft)


def edit_recipe(draft: RecipeImportDraft, recipe_id: str, edit: RecipeEdit) -> None:
    recipe = shape.find_recipe(draft.payload, recipe_id)
    if recipe is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Такого рецепта в файле нет.")
    if recipe["state"] == shape.IMPORTED:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Рецепт уже загружен. Дальше он правится в разделе «Рецепты».",
        )

    fields = edit.model_fields_set
    if "title" in fields and edit.title is not None:
        recipe["title"] = edit.title.strip()
    if "category" in fields:
        recipe["category"] = edit.category.value if edit.category else None
    if "servings" in fields and edit.servings is not None:
        recipe["servings"] = edit.servings
    if "yield_g" in fields:
        recipe["yield_g"] = edit.yield_g
    if "instructions" in fields and edit.instructions is not None:
        recipe["instructions"] = edit.instructions.strip()
    if "skipped" in fields and edit.skipped is not None:
        recipe["state"] = shape.SKIPPED if edit.skipped else shape.OPEN

    for change in edit.lines:
        _edit_line(recipe, change)
    drafts_repo.touch_payload(draft)


def _edit_line(recipe: dict[str, Any], change: LineEdit) -> None:
    if change.index >= len(recipe["lines"]):
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Такой строки в рецепте нет.")
    line = recipe["lines"][change.index]
    fields = change.model_fields_set
    if "grams" in fields and change.grams is not None:
        line["grams"] = round(change.grams, 1)
        line["confirmed"] = True
    if "confirmed" in fields and change.confirmed is not None:
        line["confirmed"] = change.confirmed
    if "left_out" in fields and change.left_out is not None:
        line["left_out"] = change.left_out


def _instructions(draft: RecipeImportDraft, reading: _Reading) -> str:
    """Instructions with the lines that are not weighed put in front.

    "Vanilla — 3 drops", "sweetener to taste" are not in the composition, and
    without this line they would vanish from the recipe: the family would cook
    a dish the dietitian did not write.
    """

    kept = [
        shape.source_line(draft.source_lines, line["line"]) or line["name"]
        for line, state in zip(reading.recipe["lines"], reading.states, strict=True)
        if state == "left_out"
    ]
    text: str = reading.recipe["instructions"]
    if kept:
        text = f"{LEFT_OUT_LABEL}: {'; '.join(kept)}.\n\n{text}".strip()
    return text[:INSTRUCTIONS_MAX]


@dataclass(frozen=True, slots=True)
class Created:
    recipe_id: uuid.UUID
    title: str
    draft_recipe_id: str


async def commit(
    session: AsyncSession,
    *,
    draft: RecipeImportDraft,
    recipe_ids: Iterable[str],
    user_id: uuid.UUID,
) -> list[Created]:
    """Create recipes from the ready rows. Returns what was created, for the audit.

    Rows that are not ready are left as they are — the reviewer imports what is
    done and comes back to the rest. A row is ready by the same reading the
    table shows, so what she accepted is what gets written.
    """

    wanted = set(recipe_ids)
    catalogue = await _catalogue(session, draft.payload)
    created: list[Created] = []
    for reading in _read_all(draft.payload, catalogue):
        recipe = reading.recipe
        if not reading.ready or (wanted and recipe["id"] not in wanted):
            continue
        assert reading.computed is not None

        row = await recipes_repo.create(
            session,
            title=recipe["title"],
            category=RecipeCategory(recipe["category"]),
            photo_path=None,
            yield_g=recipe["yield_g"] or round(sum(grams for _, grams in reading.composition), 1),
            servings=recipe["servings"],
            instructions=_instructions(draft, reading),
            author_id=user_id,
            ingredients=reading.composition,
            computed=reading.computed,
            engine_version=ENGINE_VERSION,
        )
        row.source_ref = draft.file_name[:255]
        recipe["state"] = shape.IMPORTED
        recipe["recipe_id"] = str(row.id)
        created.append(Created(recipe_id=row.id, title=row.title, draft_recipe_id=recipe["id"]))

    drafts_repo.touch_payload(draft)
    await session.flush()
    return created
