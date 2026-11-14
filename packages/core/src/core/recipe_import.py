"""The draft of a recipe file under review: its shape and the rules around it (ADR-0079).

Pure functions, no I/O. Two processes rewrite the same document — the worker
appends what the model read from the file, the API saves what the reviewer
decided — and a shape described twice would drift between them.

The document (`recipe_import_drafts.payload`):

```
{
  "recipes":     [Recipe],            # in file order
  "resolutions": {key: Resolution},   # the reviewer's decisions per name
  "candidates":  {key: [product_id]}, # catalogue suggestions per name
  "notes":       [str],               # parts of the file that were not read
}
Recipe = {
  "id", "title", "category" | None, "servings", "yield_g" | None,
  "instructions", "state": "open" | "imported" | "skipped", "recipe_id" | None,
  "lines": [Line],
}
Line = {
  "line":  number of the source line (1-based) the ingredient was read from,
  "name":  the ingredient as written, "hint": Russian name for the search | None,
  "grams": float | None, "grounded": bool, "confirmed": bool, "left_out": bool,
}
Resolution = {"product_id": str} | {"left_out": True}
```

**The model does no arithmetic.** It returns the quantity and the unit as they
stand in the file; grams are derived here, and only for units of mass. A spoon,
a cup, "to taste" give no grams: the reviewer types the mass or leaves the line
out of the calculation. A quantity that is not found in the source line is kept
but marked `grounded = False`, and such a line is not accepted in bulk.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from .repositories.product_aliases import alias_key

OPEN = "open"
IMPORTED = "imported"
SKIPPED = "skipped"

#: Grams in one unit of mass. Exact by definition (international avoirdupois).
_GRAMS_PER_UNIT: dict[str, float] = {
    "g": 1.0,
    "kg": 1000.0,
    "mg": 0.001,
    "oz": 28.349523125,
    "lb": 453.59237,
}

#: The column holds one decimal place (`recipe_ingredients.grams numeric(7,1)`).
_GRAMS_DIGITS = 1

#: The same ceiling as a hand-typed ingredient (`RecipeIngredientIn.grams`).
GRAMS_MAX = 5000.0

_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


def new_payload() -> dict[str, Any]:
    return {"recipes": [], "resolutions": {}, "candidates": {}, "notes": []}


def to_grams(quantity: float | None, unit: str | None) -> float | None:
    """Mass in grams, or `None` when the unit is not a unit of mass.

    Volume is not converted on purpose: a millilitre of oil and a millilitre of
    cream weigh differently, and a guessed density would be a made-up gram in a
    diet that is counted in grams.
    """

    if quantity is None or unit is None:
        return None
    factor = _GRAMS_PER_UNIT.get(unit.strip().lower())
    if factor is None:
        return None
    grams = round(quantity * factor, _GRAMS_DIGITS)
    if grams <= 0 or grams > GRAMS_MAX:
        return None
    return grams


def numbers_in(text: str) -> set[float]:
    """Numbers written in a line of the file; a decimal comma is a decimal point."""

    return {float(found.replace(",", ".")) for found in _NUMBER.findall(text)}


def is_grounded(quantity: float, source: str) -> bool:
    """Whether the quantity the model returned is written in the source line."""

    return any(abs(quantity - written) < 1e-9 for written in numbers_in(source))


def source_line(source_lines: list[str], number: int | None) -> str:
    """Text of a 1-based source line; empty when the model named a line that is not there."""

    if number is None or number < 1 or number > len(source_lines):
        return ""
    return source_lines[number - 1]


def build_line(
    *,
    source_lines: list[str],
    line: int | None,
    name: str,
    hint: str | None,
    quantity: float | None,
    unit: str | None,
) -> dict[str, Any]:
    grams = to_grams(quantity, unit)
    grounded = (
        grams is not None
        and quantity is not None
        and is_grounded(quantity, source_line(source_lines, line))
    )
    return {
        "line": line,
        "name": name.strip()[:255],
        "hint": (hint or "").strip()[:255] or None,
        "grams": grams,
        "grounded": grounded,
        "confirmed": False,
        "left_out": False,
    }


def build_recipe(
    *,
    title: str,
    category: str | None,
    servings: int | None,
    instructions: str,
    lines: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex[:12],
        "title": title.strip()[:255],
        "category": category,
        "servings": servings if servings is not None and 1 <= servings <= 100 else 1,
        "yield_g": None,
        "instructions": instructions.strip(),
        "state": OPEN,
        "recipe_id": None,
        "lines": lines,
    }


def instructions_from(source_lines: list[str], start: int | None, end: int | None) -> str:
    """Instructions copied from the file by line range, not retyped by the model.

    Copying keeps the text exactly as the dietitian wrote it — the model cannot
    add a step or change "175 °C" to "157 °C" in something it never emits.
    """

    if start is None or end is None or start < 1 or end < start:
        return ""
    picked = [line for line in source_lines[start - 1 : end] if line.strip()]
    return "\n".join(picked)


def name_keys(payload: dict[str, Any]) -> list[str]:
    """Distinct ingredient names of the open recipes, in order of first appearance."""

    seen: dict[str, None] = {}
    for recipe in payload.get("recipes", []):
        if recipe.get("state") != OPEN:
            continue
        for line in recipe.get("lines", []):
            seen.setdefault(alias_key(line["name"]), None)
    return [key for key in seen if key]


def find_recipe(payload: dict[str, Any], recipe_id: str) -> dict[str, Any] | None:
    for recipe in payload.get("recipes", []):
        if recipe.get("id") == recipe_id:
            return recipe  # type: ignore[no-any-return]
    return None


def chunk_end(source_lines: list[str], start: int, *, max_lines: int, max_chars: int) -> int:
    """Index after the last line of the chunk that begins at `start` (0-based).

    A chunk is bounded both ways: by lines, so the answer fits the model's
    output limit, and by characters, so a file of long table rows does not
    become one enormous request. At least one line is always taken — otherwise
    a single over-long line would stop the parser for good.
    """

    end = start
    chars = 0
    while end < len(source_lines) and end - start < max_lines:
        chars += len(source_lines[end]) + 1
        if chars > max_chars and end > start:
            break
        end += 1
    return max(end, min(start + 1, len(source_lines)))
