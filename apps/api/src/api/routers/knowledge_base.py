"""`/knowledge-base` — one article of the assistant's knowledge base.

The assistant names its sources under every reply, and the family must be able
to open them: a source written as plain text is a promise without a page.

Reading is open to everyone signed in, like `/letterhead`: published articles
are material for families, not patient data, so no patient access
check applies. The one exception is the administrator and a clinical article:
clinical content is not his at all (rule 5 of CLAUDE.md, ADR-0093), and a
guessable slug must not be a way around the 403 of the clinical section.
The Telegram bot is still refused by `BOT_ALLOWED_ROUTES` — it shows no
articles and the route is deliberately not listed there.

The text comes from the search index (`kb_chunks`), not from the article
tables: the index is exactly what the assistant read — the live version of a
published, not hidden article (ADR-0093) — and an article withdrawn, hidden or
still in draft is absent from both.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Path
from pydantic import BaseModel

from core.models.enums import UserRole
from core.repositories import knowledge_base as kb_repo

from ..deps.auth import CurrentUserDep, SessionDep
from ..errors import ApiError, ErrorCode

router = APIRouter(prefix="/knowledge-base", tags=["knowledge-base"])

#: An article slug is its file name: lowercase latin, digits and hyphens.
SLUG_PATTERN = r"^[a-z0-9-]{1,128}$"


class KbArticleRead(BaseModel):
    slug: str
    title: str
    kind: Literal["product", "clinical"]
    #: Article body in markdown without the front matter and without the title:
    #: `##` sections in the order of the source file.
    body_md: str


@router.get(
    "/articles/{slug}",
    response_model=KbArticleRead,
    summary="Статья базы знаний помощника",
)
async def read_article(
    slug: Annotated[str, Path(pattern=SLUG_PATTERN)],
    user: CurrentUserDep,
    session: SessionDep,
) -> KbArticleRead:
    found = await kb_repo.article(session, slug)
    if found is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Статья не найдена.")
    if found.kind == "clinical" and user.role == UserRole.ADMIN:
        raise ApiError(ErrorCode.FORBIDDEN, "Клинические статьи администратору недоступны.")
    return KbArticleRead.model_validate(found, from_attributes=True)
