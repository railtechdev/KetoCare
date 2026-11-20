"""Schemas of the knowledge base articles in the cabinet (ADR-0093)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

KbKind = Literal["clinical", "product"]
KbOrigin = Literal["builtin", "cabinet"]
#: State of the working (latest) version: `draft`, `review` (clinical only),
#: `published` (it is the live one), `withdrawn` (published, then taken out).
#: Whether the assistant reads the article at all is `is_live`: while a new
#: version is drafted the previous published one stays live.
KbStatus = Literal["draft", "review", "published", "withdrawn"]

#: Rule kinds of the assistant's answer filter (`core.textguard.assistant_guard`).
KbWarningKind = Literal[
    "dosing", "therapy_change", "symptom_reading", "diagnosis", "unreadable", "internal"
]

#: sha256 of the version's title, text and sources, hex.
ContentHash = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]

#: Articles are pages, not books; the limit matches the file converter's.
MAX_BODY_CHARS = 100_000


class KbGuardWarning(BaseModel):
    """A section the assistant's answer filter would block if quoted.

    A warning, not a refusal: clinical text may say what the model may not, and
    the specialist decides. The assistant answering with this section will be
    replaced by the refusal template.
    """

    #: Path of headings: «Ребёнок заболел › Лекарства».
    section: str
    #: The sentence that triggers the rule, or the section's opening one.
    sentence: str
    kind: KbWarningKind
    #: The rule, in words.
    rule: str


class KbVersionRead(BaseModel):
    id: uuid.UUID
    number: int
    title: str
    body_md: str
    sources: str | None
    author_id: uuid.UUID | None
    #: The author's name, or the label of a version from a file («KetoCare»).
    author_name: str | None
    created_at: datetime
    updated_at: datetime
    submitted_at: datetime | None
    reviewed_by: uuid.UUID | None
    #: Who published it: a person's name, or the label of an imported one («Клиника»).
    approver_name: str | None
    approved_at: datetime | None
    returned_by: uuid.UUID | None
    returned_by_name: str | None
    returned_at: datetime | None
    return_comment: str | None
    source_file_name: str | None
    #: Echoed by publish and return: the decision is about exactly this text.
    content_hash: str
    #: This is the version the assistant reads now.
    is_live: bool


class KbArticleSummary(BaseModel):
    id: uuid.UUID
    #: Permanent name: the assistant cites the article by it. Generated from the
    #: first title and never changed.
    slug: str
    kind: KbKind
    origin: KbOrigin
    status: KbStatus
    #: Built-in article taken out of the assistant by the administrator.
    hidden: bool
    title: str
    #: The assistant reads this article now.
    is_live: bool
    live_version_number: int | None
    working_version_number: int
    working_author_id: uuid.UUID | None
    working_author_name: str | None
    #: Who checked the version the assistant reads now, and when: a specialist
    #: by name, or the label of an imported signature («Клиника»). `null` while
    #: nothing is live.
    live_approver_name: str | None = None
    live_approved_at: datetime | None = None
    submitted_at: datetime | None
    updated_at: datetime
    #: Clinical, on review, and written by somebody else than the viewer.
    awaiting_my_review: bool


class KbArticlePermissions(BaseModel):
    """What the viewer may do now; the server enforces the same rules."""

    edit: bool
    submit: bool
    publish: bool
    return_to_author: bool
    withdraw: bool
    new_version: bool
    hide: bool
    show: bool
    #: Throw away the unpublished working version (`/discard-draft`).
    discard: bool


class KbArticleDetail(KbArticleSummary):
    working_version: KbVersionRead
    #: Every version, newest first.
    versions: list[KbVersionRead]
    #: Answer filter findings for the working version while it is not published.
    warnings: list[KbGuardWarning]
    can: KbArticlePermissions


class KbDiscardResult(BaseModel):
    """The answer to `/discard-draft`."""

    #: The article had never been published: it is gone together with the draft.
    deleted: bool
    #: The article as it is now; `null` when `deleted`.
    article: KbArticleDetail | None


class KbArticlePage(BaseModel):
    items: list[KbArticleSummary]
    total: int


class KbReviewCount(BaseModel):
    """Clinical articles waiting for the viewer's review — the navigation badge."""

    count: int


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Body = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_BODY_CHARS)
]


class KbArticleWrite(BaseModel):
    title: Title
    body_md: Body
    #: Where the text comes from: guidelines, articles — links or titles.
    sources: Annotated[str | None, Field(max_length=4000)] = None
    #: The Word file the text was converted from, if any.
    source_file_name: Annotated[str | None, Field(max_length=255)] = None


class KbPublishRequest(BaseModel):
    content_hash: ContentHash


class KbReturnRequest(BaseModel):
    content_hash: ContentHash
    comment: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class KbArticleText(BaseModel):
    """A file converted to article markdown; nothing is saved."""

    #: The document's first top-level heading, offered as the title.
    title: str | None
    body_md: str
    source_file_name: str
