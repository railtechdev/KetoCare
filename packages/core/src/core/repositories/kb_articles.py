"""Статьи базы знаний помощника и их редакции (ADR-0093).

Здесь только работа с таблицами. Правила — кто вправе публиковать, когда
черновик можно править — живут в `api.services.kb_articles`; индекс помощника
собирает `core.knowledge.indexer`.

Опубликованная редакция не меняется и не удаляется: запрет держит модель
(`models.knowledge`), а здесь нет ни одной функции, которая пыталась бы.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import KbArticle, KbArticleVersion

CLINICAL = "clinical"
PRODUCT = "product"

BUILTIN = "builtin"
CABINET = "cabinet"

DRAFT = "draft"
REVIEW = "review"
PUBLISHED = "published"
WITHDRAWN = "withdrawn"


async def get(
    session: AsyncSession, article_id: uuid.UUID, *, for_update: bool = False
) -> KbArticle | None:
    query = select(KbArticle).where(KbArticle.id == article_id)
    if for_update:
        query = query.with_for_update()
    return (await session.scalars(query)).one_or_none()


async def by_slug(session: AsyncSession) -> dict[str, KbArticle]:
    """Все статьи по имени — для синхронизации с файлами выпуска.

    Перечитываются из базы и те, что уже загружены в сессию
    (`populate_existing`): синхронизация решает по живой редакции, и объект с
    прежним `live_version_id` вернул бы в помощник снятую статью.
    """

    rows = (
        await session.scalars(select(KbArticle).execution_options(populate_existing=True))
    ).all()
    return {article.slug: article for article in rows}


async def slug_exists(session: AsyncSession, slug: str) -> bool:
    found = await session.scalar(select(KbArticle.id).where(KbArticle.slug == slug))
    return found is not None


def _working_author() -> Select[tuple[uuid.UUID | None]]:
    """Автор рабочей (последней) редакции статьи — подзапрос для фильтров."""

    latest = (
        select(KbArticleVersion.author_id)
        .where(KbArticleVersion.article_id == KbArticle.id)
        .order_by(KbArticleVersion.number.desc())
        .limit(1)
    )
    return latest


def _awaiting_review_of(reviewer_id: uuid.UUID) -> list[ColumnElement[bool]]:
    """Клинические статьи на проверке, которые этот человек вправе проверить."""

    author = _working_author().scalar_subquery()
    return [
        KbArticle.kind == CLINICAL,
        KbArticle.status == REVIEW,
        or_(author.is_(None), author != reviewer_id),
    ]


async def list_articles(
    session: AsyncSession,
    *,
    kind: str,
    origin: str | None = None,
    status: str | None = None,
    live: bool | None = None,
    awaiting_review_of: uuid.UUID | None = None,
    limit: int,
    offset: int,
) -> tuple[Sequence[KbArticle], int]:
    """`status` — состояние рабочей редакции; `live` — есть ли статья у
    помощника сейчас. Это разные вопросы: у опубликованной статьи с черновиком
    правки рабочая редакция — черновик, а помощник отвечает по прежней."""

    conditions: list[ColumnElement[bool]] = [KbArticle.kind == kind]
    if origin is not None:
        conditions.append(KbArticle.origin == origin)
    if status is not None:
        conditions.append(KbArticle.status == status)
    if live is True:
        conditions.extend([KbArticle.live_version_id.is_not(None), KbArticle.hidden.is_(False)])
    elif live is False:
        conditions.append(or_(KbArticle.live_version_id.is_(None), KbArticle.hidden.is_(True)))
    if awaiting_review_of is not None:
        conditions.extend(_awaiting_review_of(awaiting_review_of))

    total = await session.scalar(select(func.count()).select_from(KbArticle).where(*conditions))
    rows = (
        await session.scalars(
            select(KbArticle)
            .where(*conditions)
            .order_by(KbArticle.updated_at.desc(), KbArticle.slug)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return rows, int(total or 0)


async def count_awaiting_review(session: AsyncSession, *, reviewer_id: uuid.UUID) -> int:
    total = await session.scalar(
        select(func.count()).select_from(KbArticle).where(*_awaiting_review_of(reviewer_id))
    )
    return int(total or 0)


async def versions(session: AsyncSession, article_id: uuid.UUID) -> list[KbArticleVersion]:
    """Редакции статьи, от первой к последней."""

    rows = await session.scalars(
        select(KbArticleVersion)
        .where(KbArticleVersion.article_id == article_id)
        .order_by(KbArticleVersion.number)
    )
    return list(rows.all())


async def working_version(
    session: AsyncSession, article_id: uuid.UUID, *, for_update: bool = False
) -> KbArticleVersion:
    """Последняя редакция — та, с которой сейчас работают."""

    query = (
        select(KbArticleVersion)
        .where(KbArticleVersion.article_id == article_id)
        .order_by(KbArticleVersion.number.desc())
        .limit(1)
    )
    if for_update:
        query = query.with_for_update()
    return (await session.scalars(query)).one()


async def version(session: AsyncSession, version_id: uuid.UUID) -> KbArticleVersion | None:
    return await session.get(KbArticleVersion, version_id)


async def last_published_version(
    session: AsyncSession, article_id: uuid.UUID
) -> KbArticleVersion | None:
    return (
        await session.scalars(
            select(KbArticleVersion)
            .where(
                KbArticleVersion.article_id == article_id,
                KbArticleVersion.approved_at.is_not(None),
            )
            .order_by(KbArticleVersion.number.desc())
            .limit(1)
        )
    ).one_or_none()


async def create(
    session: AsyncSession,
    *,
    slug: str,
    kind: str,
    origin: str,
    title: str,
    body_md: str,
    sources: str | None,
    created_by: uuid.UUID | None,
    author_id: uuid.UUID | None,
    author_label: str | None = None,
    source_file_name: str | None = None,
) -> tuple[KbArticle, KbArticleVersion]:
    """Новая статья с первой редакцией в состоянии черновика."""

    article = KbArticle(
        slug=slug,
        kind=kind,
        origin=origin,
        status=DRAFT,
        hidden=False,
        title=title,
        created_by=created_by,
    )
    session.add(article)
    await session.flush()
    first = await add_version(
        session,
        article=article,
        number=1,
        title=title,
        body_md=body_md,
        sources=sources,
        author_id=author_id,
        author_label=author_label,
        source_file_name=source_file_name,
    )
    return article, first


async def add_version(
    session: AsyncSession,
    *,
    article: KbArticle,
    number: int,
    title: str,
    body_md: str,
    sources: str | None,
    author_id: uuid.UUID | None,
    author_label: str | None = None,
    source_file_name: str | None = None,
) -> KbArticleVersion:
    """Новая редакция-черновик. Живая редакция статьи при этом не меняется."""

    added = KbArticleVersion(
        article_id=article.id,
        number=number,
        title=title,
        body_md=body_md,
        sources=sources,
        author_id=author_id,
        author_label=author_label,
        source_file_name=source_file_name,
    )
    session.add(added)
    article.title = title
    article.status = DRAFT
    article.updated_at = datetime.now(UTC)
    await session.flush()
    return added


async def update_draft(
    session: AsyncSession,
    *,
    article: KbArticle,
    draft: KbArticleVersion,
    title: str,
    body_md: str,
    sources: str | None,
    source_file_name: str | None,
) -> KbArticleVersion:
    """Правка неопубликованной редакции. Правленая редакция снова черновик:
    проверяющий не должен утвердить текст, которого не читал."""

    draft.title = title
    draft.body_md = body_md
    draft.sources = sources
    if source_file_name is not None:
        draft.source_file_name = source_file_name
    draft.submitted_at = None
    article.title = title
    article.status = DRAFT
    article.updated_at = datetime.now(UTC)
    await session.flush()
    return draft


async def submit(
    session: AsyncSession, *, article: KbArticle, draft: KbArticleVersion
) -> KbArticleVersion:
    draft.submitted_at = datetime.now(UTC)
    article.status = REVIEW
    article.updated_at = datetime.now(UTC)
    await session.flush()
    return draft


async def return_to_author(
    session: AsyncSession,
    *,
    article: KbArticle,
    draft: KbArticleVersion,
    reviewer_id: uuid.UUID,
    comment: str,
) -> KbArticleVersion:
    now = datetime.now(UTC)
    draft.returned_by = reviewer_id
    draft.returned_at = now
    draft.return_comment = comment
    draft.submitted_at = None
    article.status = DRAFT
    article.updated_at = now
    await session.flush()
    return draft


async def publish(
    session: AsyncSession,
    *,
    article: KbArticle,
    draft: KbArticleVersion,
    reviewed_by: uuid.UUID | None,
    approver_label: str | None = None,
    approved_at: datetime | None = None,
) -> KbArticleVersion:
    """Опубликовать редакцию: она становится живой и больше не меняется."""

    now = datetime.now(UTC)
    draft.reviewed_by = reviewed_by
    draft.approver_label = approver_label
    draft.approved_at = approved_at or now
    await session.flush()
    article.live_version_id = draft.id
    article.status = PUBLISHED
    article.title = draft.title
    article.updated_at = now
    await session.flush()
    return draft


async def make_live(session: AsyncSession, *, article: KbArticle, live: KbArticleVersion) -> None:
    """Вернуть статье уже опубликованную редакцию — без новой."""

    article.live_version_id = live.id
    article.status = PUBLISHED
    article.title = live.title
    article.updated_at = datetime.now(UTC)
    await session.flush()


async def withdraw(session: AsyncSession, *, article: KbArticle) -> None:
    """Снять статью из помощника. Неопубликованная рабочая редакция, если она
    есть, остаётся черновиком или на проверке: снятие не стирает работу."""

    article.live_version_id = None
    if article.status == PUBLISHED:
        article.status = WITHDRAWN
    article.updated_at = datetime.now(UTC)
    await session.flush()


async def discard_draft(
    session: AsyncSession, *, article: KbArticle, draft: KbArticleVersion
) -> bool:
    """Удалить неопубликованную рабочую редакцию. True — статья удалена целиком:
    других редакций у неё не было.

    Опубликованную редакцию удалить нельзя (её охраняет модель); черновик —
    не клинические данные пациента и не текст, который читали семьи, поэтому
    он удаляется, а не помечается: иначе каждое чтение редакций несло бы
    условие «кроме выброшенных».
    """

    previous = (
        await session.scalars(
            select(KbArticleVersion)
            .where(
                KbArticleVersion.article_id == article.id,
                KbArticleVersion.number < draft.number,
            )
            .order_by(KbArticleVersion.number.desc())
            .limit(1)
        )
    ).one_or_none()
    await session.delete(draft)
    await session.flush()
    if previous is None:
        await session.delete(article)
        await session.flush()
        return True

    live = (
        await session.get(KbArticleVersion, article.live_version_id)
        if (article.live_version_id is not None)
        else None
    )
    article.status = PUBLISHED if live is not None else WITHDRAWN
    article.title = (live or previous).title
    article.updated_at = datetime.now(UTC)
    await session.flush()
    return False


async def set_hidden(session: AsyncSession, *, article: KbArticle, hidden: bool) -> None:
    article.hidden = hidden
    article.updated_at = datetime.now(UTC)
    await session.flush()


async def user_names(session: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Имена авторов и проверяющих для карточки статьи."""

    from ..models import User

    if not ids:
        return {}
    rows = await session.execute(select(User.id, User.full_name).where(User.id.in_(ids)))
    return {row.id: row.full_name for row in rows}


async def latest_versions(
    session: AsyncSession, article_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, KbArticleVersion]:
    """Рабочая редакция каждой статьи — одним запросом для перечня."""

    if not article_ids:
        return {}
    rows = await session.scalars(
        select(KbArticleVersion)
        .where(KbArticleVersion.article_id.in_(article_ids))
        .order_by(KbArticleVersion.article_id, KbArticleVersion.number.desc())
        .distinct(KbArticleVersion.article_id)
    )
    return {row.article_id: row for row in rows}


async def versions_by_id(
    session: AsyncSession, version_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, KbArticleVersion]:
    """Versions by id — the live ones of a list, for "who checked it"."""

    if not version_ids:
        return {}
    rows = await session.scalars(
        select(KbArticleVersion).where(KbArticleVersion.id.in_(version_ids))
    )
    return {version.id: version for version in rows}
