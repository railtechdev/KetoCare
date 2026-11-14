"""Recipe files under review (ADR-0079). Working state, not clinical data."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ..models import RecipeImportDraft

PARSING = "parsing"
READY = "ready"
FAILED = "failed"


async def create(
    session: AsyncSession,
    *,
    created_by: uuid.UUID,
    file_name: str,
    source_lines: list[str],
    payload: dict[str, Any],
) -> RecipeImportDraft:
    draft = RecipeImportDraft(
        created_by=created_by,
        file_name=file_name,
        status=PARSING,
        source_lines=source_lines,
        lines_done=0,
        payload=payload,
    )
    session.add(draft)
    await session.flush()
    return draft


async def get(
    session: AsyncSession, draft_id: uuid.UUID, *, for_update: bool = False
) -> RecipeImportDraft | None:
    """An open draft by id.

    `for_update` locks the row: the parser appends recipes while the reviewer
    saves decisions, and both rewrite the same JSON document. Without the lock
    the later writer would drop what the earlier one had just written.
    """

    stmt = select(RecipeImportDraft).where(
        RecipeImportDraft.id == draft_id, RecipeImportDraft.closed_at.is_(None)
    )
    if for_update:
        stmt = stmt.with_for_update()
    draft: RecipeImportDraft | None = await session.scalar(stmt)
    return draft


async def list_open(session: AsyncSession, *, created_by: uuid.UUID) -> list[RecipeImportDraft]:
    """The reviewer's own unfinished files, newest first."""

    rows = await session.scalars(
        select(RecipeImportDraft)
        .where(
            RecipeImportDraft.created_by == created_by,
            RecipeImportDraft.closed_at.is_(None),
        )
        .order_by(RecipeImportDraft.created_at.desc())
    )
    return list(rows)


def touch_payload(draft: RecipeImportDraft) -> None:
    """Tell the ORM the JSON document was changed in place."""

    flag_modified(draft, "payload")


async def close(session: AsyncSession, *, draft: RecipeImportDraft) -> None:
    draft.closed_at = datetime.now(UTC)
    await session.flush()
