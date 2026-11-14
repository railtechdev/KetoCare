"""Reading a dietitian's recipe file into a draft for review (ADR-0079).

The dietitian uploads the file she already has — any layout, any language — and
gets a table to review instead of a list of errors. This module is the reader.
What keeps it safe:

1. **The model points, it does not retype.** It returns the number of the source
   line an ingredient stands on and the quantity with its unit as written;
   grams are derived by `core.recipe_import`, and a quantity that is not found
   in that line is marked for the reviewer. Instructions are copied from the
   file by line range.
2. **The model never names a product of the catalogue.** It may translate a
   name into Russian; the catalogue is searched by the server, and what is
   found is only a suggestion the reviewer accepts with a click.
3. **Nothing becomes a recipe here.** The draft is working state. Recipes are
   created by the API when the reviewer accepts them (rule 6 of CLAUDE.md).

A file is read in parts, one task run per part: a collection of two hundred
recipes takes longer than one task may run, and a part that failed must not
lose the parts already read.
"""

from __future__ import annotations

import json
import re
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from core import recipe_import as draft_shape
from core.models.enums import AiJobKind, RecipeCategory
from core.repositories import product_aliases as aliases_repo
from core.repositories import products as products_repo
from core.repositories import recipe_import_drafts as drafts_repo

from .client import AiClient, AiError, AiLimitExceeded
from .parse import first_problem, without_fence

#: One part of the file. Ninety lines is five to eight recipes; the answer for
#: them fits the output limit with room to spare.
CHUNK_LINES = 90
CHUNK_CHARS = 7000

MAX_TOKENS = 8000

#: One part is read in the background; nobody is waiting on a connection.
TIMEOUT_S = 150.0

#: How many catalogue suggestions are kept per name.
MAX_CANDIDATES = 5

_WORD = re.compile(r"[^\W\d_]{4,}", re.UNICODE)
_BRACKETS = re.compile(r"\([^)]*\)")

_CATEGORIES = {item.value for item in RecipeCategory}


class ReadIngredient(BaseModel):
    model_config = ConfigDict(extra="ignore")

    line: int | None = None
    name: str = Field(min_length=1)
    name_ru: str | None = None
    quantity: float | None = None
    unit: str | None = None


class ReadRecipe(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1)
    category: str | None = None
    servings: int | None = None
    ingredients: list[ReadIngredient] = []
    instructions_from: int | None = None
    instructions_to: int | None = None
    instructions: str | None = None


class ReadAnswer(BaseModel):
    model_config = ConfigDict(extra="ignore")

    recipes: list[ReadRecipe] = []
    resume_from_line: int | None = None


@lru_cache(maxsize=1)
def prompt() -> str:
    """The system prompt lives in a file and changes by its own PR (section 10.4)."""

    return (Path(__file__).parent / "prompts" / "recipe_import.md").read_text(encoding="utf-8")


async def read_part(
    client: AiClient,
    *,
    requested_by: uuid.UUID,
    source_lines: list[str],
    start: int,
    end: int,
) -> ReadAnswer | None:
    """Ask the model about lines `start..end` (0-based, end exclusive).

    One retry naming the problem, as with the free-text parser; `None` after
    the second invalid answer — the caller notes the part as unread instead of
    stopping the whole file.
    """

    payload: dict[str, Any] = {
        "first_line": start + 1,
        "last_line": end,
        "lines": [
            {"n": number, "text": source_lines[number - 1]} for number in range(start + 1, end + 1)
        ],
    }

    complaint: str | None = None
    for attempt in (1, 2):
        answer = await client.ask(
            kind=AiJobKind.RECIPE_IMPORT,
            requested_by=requested_by,
            # A recipe file is not about a particular child.
            patient_id=None,
            system=prompt(),
            payload=payload,
            user_text=complaint,
            max_tokens=MAX_TOKENS,
            timeout_s=TIMEOUT_S,
        )
        try:
            return _validated(answer.text)
        except ValueError as error:
            if attempt == 2:
                break
            complaint = (
                f"Твой прошлый ответ не подошёл: {error}. Верни только JSON по описанной схеме."
            )
    return None


def _validated(raw: str) -> ReadAnswer:
    try:
        data = json.loads(without_fence(raw))
    except json.JSONDecodeError as error:
        raise ValueError(f"это не JSON ({error.msg})") from error
    try:
        return ReadAnswer.model_validate(data)
    except ValidationError as error:
        raise ValueError(first_problem(error)) from error


def to_draft_recipes(
    answer: ReadAnswer, *, source_lines: list[str], start: int, end: int
) -> list[dict[str, Any]]:
    """The model's answer in the shape of the draft, checked against the file.

    A line number outside the part the model was given is dropped rather than
    trusted: the ingredient stays, without a source line, and therefore without
    a grounded quantity — the reviewer confirms its mass by hand.
    """

    def within(number: int | None) -> int | None:
        return number if number is not None and start < number <= end else None

    recipes: list[dict[str, Any]] = []
    for read in answer.recipes:
        lines = [
            draft_shape.build_line(
                source_lines=source_lines,
                line=within(item.line),
                name=item.name,
                hint=item.name_ru,
                quantity=item.quantity if item.quantity and item.quantity > 0 else None,
                unit=item.unit,
            )
            for item in read.ingredients
            if item.name.strip()
        ]
        instructions = draft_shape.instructions_from(
            source_lines, within(read.instructions_from), within(read.instructions_to)
        ) or (read.instructions or "")
        recipes.append(
            draft_shape.build_recipe(
                title=read.title,
                category=read.category if read.category in _CATEGORIES else None,
                servings=read.servings,
                instructions=instructions,
                lines=lines,
            )
        )
    return recipes


def next_position(answer: ReadAnswer, *, start: int, end: int, total: int) -> tuple[int, bool]:
    """Where the next part begins, and whether a recipe was left unread.

    The model may ask to re-read from the line where a recipe cut by the end of
    the part begins. That is honoured only when it moves the reader forward: a
    recipe longer than a whole part would otherwise be asked for again and
    again, so it is skipped and reported.
    """

    resume = answer.resume_from_line
    if resume is None or end >= total:
        return end, False
    if start + 1 < resume <= end:
        return resume - 1, False
    return end, True


async def suggest(session: AsyncSession, *, name: str, hint: str | None) -> list[str]:
    """Catalogue products that may be what the file calls `name`.

    Suggestions only: the reviewer picks one with a click, and nothing is
    matched on the strength of a search. The whole phrase is tried first — it
    is the most specific — then the name without its bracketed remarks, then
    single words, so "Орехи макадамия (обжаренные)" still finds "Макадамия".
    """

    found: dict[str, None] = {}
    queries: list[str] = []
    for text in (name, hint or ""):
        bare = _BRACKETS.sub(" ", text).strip()
        queries.extend(query for query in (text.strip(), bare) if query)
    for text in (name, hint or ""):
        queries.extend(_WORD.findall(_BRACKETS.sub(" ", text).lower())[:3])

    for query in dict.fromkeys(queries):
        products, _ = await products_repo.search(session, q=query, limit=MAX_CANDIDATES)
        for product in products:
            found.setdefault(str(product.id), None)
            if len(found) >= MAX_CANDIDATES:
                return list(found)
    return list(found)


async def advance(
    sessionmaker: async_sessionmaker[AsyncSession], client: AiClient, draft_id: uuid.UUID
) -> bool:
    """Read the next part of the file. Returns whether there is more to read."""

    async with sessionmaker() as session:
        draft = await drafts_repo.get(session, draft_id)
        if draft is None or draft.status != drafts_repo.PARSING:
            return False
        source_lines = list(draft.source_lines)
        start = draft.lines_done
        requested_by = draft.created_by

    total = len(source_lines)
    end = draft_shape.chunk_end(source_lines, start, max_lines=CHUNK_LINES, max_chars=CHUNK_CHARS)

    failure: str | None = None
    answer: ReadAnswer | None = None
    try:
        answer = await read_part(
            client, requested_by=requested_by, source_lines=source_lines, start=start, end=end
        )
    except AiLimitExceeded as error:
        failure = str(error)
    except AiError:
        failure = "Разбор сейчас недоступен. Попробуйте продолжить позже."

    async with sessionmaker() as session:
        draft = await drafts_repo.get(session, draft_id, for_update=True)
        # Another run got here first (the task was started twice), or the
        # reviewer removed the draft while the model was answering.
        if draft is None or draft.status != drafts_repo.PARSING or draft.lines_done != start:
            return False

        if failure is not None:
            draft.status = drafts_repo.FAILED
            draft.failure = failure
            await session.commit()
            return False

        payload = draft.payload
        if answer is None:
            payload["notes"].append(f"Строки {start + 1}–{end} прочитать не удалось.")
            position = end
        else:
            position, skipped = next_position(answer, start=start, end=end, total=total)
            if skipped:
                payload["notes"].append(
                    f"Рецепт в строках {start + 1}–{end} слишком длинный и не прочитан."
                )
            recipes = to_draft_recipes(answer, source_lines=source_lines, start=start, end=end)
            payload["recipes"].extend(recipes)
            for recipe in recipes:
                for line in recipe["lines"]:
                    key = aliases_repo.alias_key(line["name"])
                    if key and key not in payload["candidates"]:
                        payload["candidates"][key] = await suggest(
                            session, name=line["name"], hint=line["hint"]
                        )

        draft.lines_done = position
        more = position < total
        if not more:
            draft.status = drafts_repo.READY
        drafts_repo.touch_payload(draft)
        await session.commit()
        return more


async def parse_recipe_file(ctx: dict[str, Any], draft_id: str) -> None:
    """ARQ task: read one part of the file and queue itself for the next.

    Access is checked by the endpoint that created the draft; the task acts for
    the draft's author and reads nothing but the draft and the catalogue.
    """

    from core.db import get_sessionmaker

    from .client import build_ai_client

    more = await advance(get_sessionmaker(), build_ai_client(), uuid.UUID(draft_id))
    if more:
        await ctx["redis"].enqueue_job("parse_recipe_file", draft_id)
