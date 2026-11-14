"""Schemas of `/recipe-imports` — a recipe file under review (ADR-0079)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from core.models.enums import RecipeCategory

DraftStatus = Literal["parsing", "ready", "failed"]

#: What the reviewer has to do with a name from the file.
NameState = Literal["matched", "left_out", "unresolved"]

#: How a name got its product: the same name in the catalogue, a match somebody
#: made earlier, or this reviewer's own choice.
MatchSource = Literal["exact", "alias", "manual"]

#: `ok` — goes into the composition. `left_out` — stays in the text of the
#: recipe, not in the calculation. The rest wait for the reviewer.
LineState = Literal["ok", "left_out", "no_product", "no_grams", "unconfirmed"]

RecipeState = Literal["ready", "needs_work", "imported", "skipped"]

RecipeProblem = Literal["title", "title_taken", "category", "lines", "empty", "too_many"]


class ImportProduct(BaseModel):
    id: uuid.UUID
    name_ru: str
    #: A seasoning (ADR-0054): it may stand in a recipe without a mass.
    counts_in_calculation: bool


class ImportName(BaseModel):
    """One ingredient name of the file — decided once for every recipe it is in."""

    key: str
    name: str
    #: The name in Russian when the file is in another language.
    hint: str | None
    recipes: int
    state: NameState
    source: MatchSource | None
    product: ImportProduct | None
    candidates: list[ImportProduct]


class ImportLine(BaseModel):
    index: int
    #: The line of the file this ingredient was read from, as written.
    source: str
    name: str
    key: str
    grams: float | None
    state: LineState
    #: The reviewer left this very line out; a line may also be `left_out`
    #: because of its name or because it is a seasoning without a mass.
    left_out: bool
    product_name: str | None


class ImportRecipe(BaseModel):
    id: str
    title: str
    category: RecipeCategory | None
    servings: int
    yield_g: float | None
    instructions: str
    state: RecipeState
    problems: list[RecipeProblem]
    #: The recipe created from this row, once it is imported.
    recipe_id: uuid.UUID | None
    #: Computed by the engine for the whole dish; absent until every line is settled.
    kcal: float | None
    ratio: float | None
    lines: list[ImportLine]


class RecipeImportSummary(BaseModel):
    id: uuid.UUID
    file_name: str
    status: DraftStatus
    created_at: datetime
    lines_total: int
    lines_done: int
    recipes: int
    imported: int


class RecipeImportView(RecipeImportSummary):
    failure: str | None
    #: Parsing has not moved for a while; the reviewer may ask to continue.
    stalled: bool
    notes: list[str]
    names: list[ImportName]
    items: list[ImportRecipe]
    ready: int


class NameDecision(BaseModel):
    """The reviewer's decision about a name. Both empty — the decision is withdrawn."""

    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=255)
    product_id: uuid.UUID | None = None
    left_out: bool = False


class LineEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    index: Annotated[int, Field(ge=0)]
    #: A mass typed by the reviewer. It counts as confirmed: she is the source.
    grams: Annotated[float, Field(gt=0, le=5000)] | None = None
    #: The mass read from the file is right, though it was not found in the line.
    confirmed: bool | None = None
    left_out: bool | None = None


class RecipeEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=255)
    category: RecipeCategory | None = None
    servings: Annotated[int, Field(ge=1, le=100)] | None = None
    yield_g: Annotated[float, Field(gt=0, le=99999.9)] | None = None
    instructions: str | None = Field(default=None, max_length=20000)
    skipped: bool | None = None
    lines: list[LineEdit] = Field(default_factory=list, max_length=100)


class CommitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Rows to import; empty means every ready row.
    recipe_ids: list[str] = Field(default_factory=list, max_length=1000)


class CommitResult(BaseModel):
    imported: int
    draft: RecipeImportView
