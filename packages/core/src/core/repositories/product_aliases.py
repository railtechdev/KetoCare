"""Remembered matches between a name in somebody's file and a product (ADR-0079)."""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ProductAlias

_SPACES = re.compile(r"\s+")

#: Punctuation that ends a name in a list ("Соль;", "Масло сливочное.") and
#: carries no meaning.
_EDGE = " \t\r\n.,;:!·•-–—"


def alias_key(name: str) -> str:
    """One spelling of a name: case, edge punctuation and runs of spaces ignored.

    Looser than the catalogue's own uniqueness rule on purpose. There a name is
    a product's identity; here it is a line somebody typed in a recipe, and
    "Масло  сливочное." must find what "масло сливочное" was matched to.
    Nothing inside the name is dropped: "сливки 10%" and "сливки 33%" stay
    different, as they must.
    """

    return _SPACES.sub(" ", name).strip(_EDGE).casefold()[:255]


async def get_many(session: AsyncSession, *, keys: Iterable[str]) -> dict[str, uuid.UUID]:
    """Product ids for the given alias keys; unknown keys are simply absent."""

    wanted = {key for key in keys if key}
    if not wanted:
        return {}

    rows = await session.execute(
        select(ProductAlias.alias, ProductAlias.product_id).where(ProductAlias.alias.in_(wanted))
    )
    return {alias: product_id for alias, product_id in rows}


async def remember(
    session: AsyncSession, *, key: str, product_id: uuid.UUID, created_by: uuid.UUID
) -> None:
    """Point the spelling at the product; a later decision replaces an earlier one."""

    stmt = insert(ProductAlias).values(alias=key, product_id=product_id, created_by=created_by)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[ProductAlias.alias],
            set_={"product_id": product_id, "created_by": created_by},
        )
    )
