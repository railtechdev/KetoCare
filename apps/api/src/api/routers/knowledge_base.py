"""`/knowledge-base` — one article of the assistant's knowledge base.

The assistant names its sources under every reply, and the family must be able
to open them: a source written as plain text is a promise without a page.

Reading is open to everyone signed in, like `/letterhead`: articles are public
material from `docs/knowledge-base`, not patient data, so no patient access
check applies. The Telegram bot is still refused by `BOT_ALLOWED_ROUTES` — it
shows no articles and the route is deliberately not listed there.

The text comes from the search index (`kb_chunks`), not from the file: the
index is exactly what the assistant read, and an article withdrawn or still in
draft is absent from both.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Path
from pydantic import BaseModel

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
    _user: CurrentUserDep,
    session: SessionDep,
) -> KbArticleRead:
    found = await kb_repo.article(session, slug)
    if found is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Статья не найдена.")
    return KbArticleRead.model_validate(found, from_attributes=True)
