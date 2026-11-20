"""Knowledge base articles written in the cabinet (ADR-0093).

- `/knowledge-base/clinical-articles` — the doctor's and the dietitian's. Four
  eyes: the author submits, another specialist publishes or returns. The
  administrator gets 403 on every route: clinical content is not his.
- `/admin/knowledge-base/product-articles` — the administrator's. Built-in
  articles (shipped with the release) are hidden or shown; his own are written
  and published by him.
- `/knowledge-base/article-text` — a Word file converted to article markdown
  for the form; nothing is saved.

The family reads published articles through `GET /knowledge-base/articles/{slug}`
(`routers.knowledge_base`), which serves the assistant's index. None of these
routes is open to the Telegram bot (`BOT_ALLOWED_ROUTES` does not list them).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Path, Query, Request, UploadFile, status

from core.models.enums import UserRole
from core.repositories import kb_articles as repo

from ..client_address import client_address
from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
from ..ratelimit import IMPORT_RATE_LIMIT, limiter
from ..schemas_kb import (
    KbArticleDetail,
    KbArticlePage,
    KbArticleText,
    KbArticleWrite,
    KbDiscardResult,
    KbOrigin,
    KbPublishRequest,
    KbReturnRequest,
    KbReviewCount,
    KbStatus,
)
from ..services import article_file, recipe_file, uploads
from ..services import kb_articles as service

_SPECIALISTS = (UserRole.DOCTOR, UserRole.DIETITIAN)

clinical_router = APIRouter(
    prefix="/knowledge-base/clinical-articles",
    tags=["knowledge-base"],
    dependencies=[Depends(require_roles(*_SPECIALISTS))],
)
admin_router = APIRouter(
    prefix="/admin/knowledge-base/product-articles",
    tags=["admin"],
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)
text_router = APIRouter(
    prefix="/knowledge-base",
    tags=["knowledge-base"],
    dependencies=[Depends(require_roles(*_SPECIALISTS, UserRole.ADMIN))],
)

ArticleId = Annotated[uuid.UUID, Path()]


# --- clinical ---------------------------------------------------------------


@clinical_router.get("", response_model=KbArticlePage, summary="Клинические статьи помощника")
async def list_clinical(
    user: CurrentUserDep,
    session: SessionDep,
    page: PaginationDep,
    status_filter: Annotated[KbStatus | None, Query(alias="status")] = None,
    live: Annotated[
        bool | None,
        Query(description="Только статьи, по которым помощник отвечает сейчас (или только нет)"),
    ] = None,
    awaiting_my_review: Annotated[
        bool, Query(description="Только статьи на проверке, написанные не мной")
    ] = False,
) -> KbArticlePage:
    rows, total = await repo.list_articles(
        session,
        kind=repo.CLINICAL,
        status=status_filter,
        live=live,
        awaiting_review_of=user.id if awaiting_my_review else None,
        limit=page.limit,
        offset=page.offset,
    )
    items = await service.summaries(session, list(rows), viewer=user)
    return KbArticlePage(items=items, total=total)


@clinical_router.get(
    "/review-count",
    response_model=KbReviewCount,
    summary="Сколько клинических статей ждут моей проверки",
)
async def clinical_review_count(user: CurrentUserDep, session: SessionDep) -> KbReviewCount:
    return KbReviewCount(count=await repo.count_awaiting_review(session, reviewer_id=user.id))


@clinical_router.post(
    "",
    response_model=KbArticleDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Новая клиническая статья (черновик)",
)
async def create_clinical(
    payload: KbArticleWrite, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    article = await service.create(
        session, kind=repo.CLINICAL, payload=payload, user=user, ip=client_address(request)
    )
    return await service.detail(session, article, viewer=user)


@clinical_router.get(
    "/{article_id}", response_model=KbArticleDetail, summary="Клиническая статья с версиями"
)
async def get_clinical(
    article_id: ArticleId, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    article = await service.get_article(session, article_id, kind=repo.CLINICAL)
    return await service.detail(session, article, viewer=user)


@clinical_router.put(
    "/{article_id}", response_model=KbArticleDetail, summary="Править черновик клинической статьи"
)
async def update_clinical(
    article_id: ArticleId,
    payload: KbArticleWrite,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> KbArticleDetail:
    """Only the author of the working version edits it. Editing a version on
    review makes it a draft again: nobody approves a text he has not read."""

    article = await service.get_article(session, article_id, kind=repo.CLINICAL, for_update=True)
    await service.update(
        session, article=article, payload=payload, user=user, ip=client_address(request)
    )
    return await service.detail(session, article, viewer=user)


@clinical_router.post(
    "/{article_id}/submit",
    response_model=KbArticleDetail,
    summary="Отправить клиническую статью на проверку",
)
async def submit_clinical(
    article_id: ArticleId, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    """The answer carries `warnings`: sections the assistant's answer filter
    would block if quoted. A warning, not a refusal — the specialist decides."""

    article = await service.get_article(session, article_id, kind=repo.CLINICAL, for_update=True)
    await service.submit(session, article=article, user=user, ip=client_address(request))
    return await service.detail(session, article, viewer=user)


@clinical_router.post(
    "/{article_id}/publish",
    response_model=KbArticleDetail,
    summary="Опубликовать клиническую статью (проверяющий, не автор)",
)
async def publish_clinical(
    article_id: ArticleId,
    payload: KbPublishRequest,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> KbArticleDetail:
    """409 `four_eyes` when the reviewer wrote the version under review, 409
    `content_changed` when the text differs from the one the reviewer saw."""

    article = await service.get_article(session, article_id, kind=repo.CLINICAL, for_update=True)
    await service.publish(
        session,
        article=article,
        seen_hash=payload.content_hash,
        user=user,
        ip=client_address(request),
    )
    return await service.detail(session, article, viewer=user)


@clinical_router.post(
    "/{article_id}/return",
    response_model=KbArticleDetail,
    summary="Вернуть клиническую статью автору с комментарием",
)
async def return_clinical(
    article_id: ArticleId,
    payload: KbReturnRequest,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> KbArticleDetail:
    article = await service.get_article(session, article_id, kind=repo.CLINICAL, for_update=True)
    await service.return_to_author(
        session,
        article=article,
        seen_hash=payload.content_hash,
        comment=payload.comment,
        user=user,
        ip=client_address(request),
    )
    return await service.detail(session, article, viewer=user)


@clinical_router.post(
    "/{article_id}/withdraw",
    response_model=KbArticleDetail,
    summary="Снять клиническую статью из помощника",
)
async def withdraw_clinical(
    article_id: ArticleId, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    """Any doctor or dietitian, at once and without review: taking a text away
    from the assistant must not wait for a second person."""

    article = await service.get_article(session, article_id, kind=repo.CLINICAL, for_update=True)
    await service.withdraw(session, article=article, user=user, ip=client_address(request))
    return await service.detail(session, article, viewer=user)


@clinical_router.post(
    "/{article_id}/new-version",
    response_model=KbArticleDetail,
    summary="Начать новую версию опубликованной клинической статьи",
)
async def new_clinical_version(
    article_id: ArticleId, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    """A draft copy of the latest version, authored by the caller. The published
    version stays live until the new one is published."""

    article = await service.get_article(session, article_id, kind=repo.CLINICAL, for_update=True)
    await service.new_version(session, article=article, user=user, ip=client_address(request))
    return await service.detail(session, article, viewer=user)


async def _discard(
    article_id: uuid.UUID, kind: str, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbDiscardResult:
    article = await service.get_article(session, article_id, kind=kind, for_update=True)
    deleted = await service.discard_draft(
        session, article=article, user=user, ip=client_address(request)
    )
    if deleted:
        return KbDiscardResult(deleted=True, article=None)
    return KbDiscardResult(
        deleted=False, article=await service.detail(session, article, viewer=user)
    )


@clinical_router.post(
    "/{article_id}/discard-draft",
    response_model=KbDiscardResult,
    summary="Удалить неопубликованную версию клинической статьи",
)
async def discard_clinical_draft(
    article_id: ArticleId, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbDiscardResult:
    """The author, while it is a draft or on review; any other specialist while
    it is a draft — an abandoned draft must not lock the article. The published
    version, if any, stays live; an article never published goes with it."""

    return await _discard(article_id, repo.CLINICAL, request, user, session)


# --- product (administrator) ----------------------------------------------


@admin_router.get("", response_model=KbArticlePage, summary="Продуктовые статьи помощника")
async def list_product(
    user: CurrentUserDep,
    session: SessionDep,
    page: PaginationDep,
    origin: Annotated[KbOrigin | None, Query()] = None,
    status_filter: Annotated[KbStatus | None, Query(alias="status")] = None,
) -> KbArticlePage:
    rows, total = await repo.list_articles(
        session,
        kind=repo.PRODUCT,
        origin=origin,
        status=status_filter,
        limit=page.limit,
        offset=page.offset,
    )
    items = await service.summaries(session, list(rows), viewer=user)
    return KbArticlePage(items=items, total=total)


@admin_router.post(
    "",
    response_model=KbArticleDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Новая своя продуктовая статья (черновик)",
)
async def create_product(
    payload: KbArticleWrite, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    article = await service.create(
        session, kind=repo.PRODUCT, payload=payload, user=user, ip=client_address(request)
    )
    return await service.detail(session, article, viewer=user)


@admin_router.get(
    "/{article_id}", response_model=KbArticleDetail, summary="Продуктовая статья с версиями"
)
async def get_product(
    article_id: ArticleId, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    article = await service.get_article(session, article_id, kind=repo.PRODUCT)
    return await service.detail(session, article, viewer=user)


@admin_router.put(
    "/{article_id}", response_model=KbArticleDetail, summary="Править черновик своей статьи"
)
async def update_product(
    article_id: ArticleId,
    payload: KbArticleWrite,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> KbArticleDetail:
    article = await service.get_article(session, article_id, kind=repo.PRODUCT, for_update=True)
    await service.update(
        session, article=article, payload=payload, user=user, ip=client_address(request)
    )
    return await service.detail(session, article, viewer=user)


@admin_router.post(
    "/{article_id}/publish", response_model=KbArticleDetail, summary="Опубликовать свою статью"
)
async def publish_product(
    article_id: ArticleId,
    payload: KbPublishRequest,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> KbArticleDetail:
    article = await service.get_article(session, article_id, kind=repo.PRODUCT, for_update=True)
    await service.publish(
        session,
        article=article,
        seen_hash=payload.content_hash,
        user=user,
        ip=client_address(request),
    )
    return await service.detail(session, article, viewer=user)


@admin_router.post(
    "/{article_id}/withdraw",
    response_model=KbArticleDetail,
    summary="Снять свою статью из помощника",
)
async def withdraw_product(
    article_id: ArticleId, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    article = await service.get_article(session, article_id, kind=repo.PRODUCT, for_update=True)
    await service.withdraw(session, article=article, user=user, ip=client_address(request))
    return await service.detail(session, article, viewer=user)


@admin_router.post(
    "/{article_id}/new-version",
    response_model=KbArticleDetail,
    summary="Начать новую версию своей статьи",
)
async def new_product_version(
    article_id: ArticleId, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    article = await service.get_article(session, article_id, kind=repo.PRODUCT, for_update=True)
    await service.new_version(session, article=article, user=user, ip=client_address(request))
    return await service.detail(session, article, viewer=user)


@admin_router.post(
    "/{article_id}/discard-draft",
    response_model=KbDiscardResult,
    summary="Удалить неопубликованную версию своей статьи",
)
async def discard_product_draft(
    article_id: ArticleId, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbDiscardResult:
    return await _discard(article_id, repo.PRODUCT, request, user, session)


async def _set_hidden(
    article_id: uuid.UUID,
    hidden: bool,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> KbArticleDetail:
    article = await service.get_article(session, article_id, kind=repo.PRODUCT, for_update=True)
    await service.set_hidden(
        session, article=article, hidden=hidden, user=user, ip=client_address(request)
    )
    return await service.detail(session, article, viewer=user)


@admin_router.post(
    "/{article_id}/hide",
    response_model=KbArticleDetail,
    summary="Скрыть встроенную статью из помощника",
)
async def hide_product(
    article_id: ArticleId, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    return await _set_hidden(article_id, True, request, user, session)


@admin_router.post(
    "/{article_id}/show",
    response_model=KbArticleDetail,
    summary="Вернуть встроенную статью в помощник",
)
async def show_product(
    article_id: ArticleId, request: Request, user: CurrentUserDep, session: SessionDep
) -> KbArticleDetail:
    return await _set_hidden(article_id, False, request, user, session)


# --- Word to markdown -------------------------------------------------------


@text_router.post(
    "/article-text",
    response_model=KbArticleText,
    summary="Текст статьи из файла Word",
)
@limiter.limit(IMPORT_RATE_LIMIT)
async def article_text(
    request: Request,
    _user: CurrentUserDep,
    file: Annotated[UploadFile, File()],
) -> KbArticleText:
    """Converts the file for the form and saves nothing: the author checks the
    result, and only then the article is created or updated. PDF, .doc and
    pictures are refused with a way out — save as .docx or paste the text."""

    try:
        converted = article_file.extract_article(await uploads.read_within_limit(file))
    except recipe_file.UnreadableFile as error:
        raise ApiError(ErrorCode.VALIDATION_ERROR, str(error)) from error
    return KbArticleText(
        title=converted.title,
        body_md=converted.body_md,
        source_file_name=((file.filename or "").strip() or "Файл")[:255],
    )
