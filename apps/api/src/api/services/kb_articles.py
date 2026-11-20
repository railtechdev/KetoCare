"""Rules of the knowledge base articles in the cabinet (ADR-0093).

Two circles, never mixed:

- **clinical** articles belong to the doctor and the dietitian. Any of them
  writes a draft and submits it; **another** specialist — not the author of the
  version under review — publishes it or returns it with a comment. The
  administrator does not see them at all (rule 5 of CLAUDE.md);
- **product** articles belong to the administrator. Built-in ones arrive with
  the release and are only hidden or shown here; his own he writes and
  publishes himself — product text is not clinical, and a second pair of eyes
  is not required.

Every decision about the assistant's text is made against the exact text the
person saw: publish and return carry the version's `content_hash`, and a text
changed in the meantime is refused, not approved unread.

Publishing, withdrawing, hiding and showing rebuild the article's piece of the
search index in the same transaction, so the assistant sees the change at once.
Every write first takes the index lock (`core.knowledge.indexer.lock_index`),
the one the release sync holds for its whole run: a withdrawal made while a
deploy re-indexes waits for it and is not undone by the sync's stale objects.
The lock is taken before the article row, in the same order as the sync, so
the two never deadlock.
"""

from __future__ import annotations

import hashlib
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.knowledge.documents import article_paths
from core.knowledge.indexer import AUDIT_ENTITY, lock_index, reindex_article
from core.knowledge.review import draft_warnings
from core.knowledge.slugs import slug_base, with_suffix
from core.models import KbArticle, KbArticleVersion
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import kb_articles as repo

from ..deps.auth import CurrentUser
from ..errors import ApiError, ErrorCode
from ..schemas_kb import (
    KbArticleDetail,
    KbArticlePermissions,
    KbArticleSummary,
    KbArticleWrite,
    KbGuardWarning,
    KbVersionRead,
)

#: How many `-2`, `-3`… suffixes to try before giving up on a title.
_SLUG_ATTEMPTS = 200
#: Free names tried in turn when another create takes one in between.
_SLUG_RACE_RETRIES = 3


def content_hash(version: KbArticleVersion) -> str:
    raw = "\x1f".join((version.title, version.body_md, version.sources or ""))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# --- reading ----------------------------------------------------------------


async def get_article(
    session: AsyncSession, article_id: uuid.UUID, *, kind: str, for_update: bool = False
) -> KbArticle:
    """The article of this circle. Another circle's article is "not found":
    its existence is none of this reader's business.

    `for_update` is the start of a write: the index lock first, then the row.
    """

    if for_update:
        await lock_index(session)
    article = await repo.get(session, article_id, for_update=for_update)
    if article is None or article.kind != kind:
        raise ApiError(ErrorCode.NOT_FOUND, "Статья не найдена.")
    return article


def _awaiting_review_of(article: KbArticle, working: KbArticleVersion, viewer: CurrentUser) -> bool:
    return (
        article.kind == repo.CLINICAL
        and article.status == repo.REVIEW
        and working.author_id != viewer.id
        and viewer.role in (UserRole.DOCTOR, UserRole.DIETITIAN)
    )


def _summary(
    article: KbArticle,
    working: KbArticleVersion,
    *,
    live: KbArticleVersion | None,
    names: dict[uuid.UUID, str],
    viewer: CurrentUser,
) -> KbArticleSummary:
    return KbArticleSummary(
        id=article.id,
        slug=article.slug,
        kind=article.kind,  # type: ignore[arg-type]
        origin=article.origin,  # type: ignore[arg-type]
        status=article.status,  # type: ignore[arg-type]
        hidden=article.hidden,
        title=article.title,
        is_live=article.live_version_id is not None,
        live_version_number=live.number if live is not None else None,
        working_version_number=working.number,
        working_author_id=working.author_id,
        working_author_name=_name(working.author_id, working.author_label, names),
        live_approver_name=(
            _name(live.reviewed_by, live.approver_label, names) if live is not None else None
        ),
        live_approved_at=live.approved_at if live is not None else None,
        submitted_at=working.submitted_at,
        updated_at=article.updated_at,
        awaiting_my_review=_awaiting_review_of(article, working, viewer),
    )


def _name(user_id: uuid.UUID | None, label: str | None, names: dict[uuid.UUID, str]) -> str | None:
    if user_id is not None:
        return names.get(user_id, label)
    return label


async def summaries(
    session: AsyncSession, articles: list[KbArticle], *, viewer: CurrentUser
) -> list[KbArticleSummary]:
    working = await repo.latest_versions(session, [a.id for a in articles])
    live = await repo.versions_by_id(
        session, [a.live_version_id for a in articles if a.live_version_id is not None]
    )
    people = {v.author_id for v in working.values() if v.author_id is not None} | {
        v.reviewed_by for v in live.values() if v.reviewed_by is not None
    }
    names = await repo.user_names(session, people)
    return [
        _summary(
            article,
            working[article.id],
            live=live.get(article.live_version_id) if article.live_version_id is not None else None,
            names=names,
            viewer=viewer,
        )
        for article in articles
    ]


def _version_read(
    version: KbArticleVersion, *, live_id: uuid.UUID | None, names: dict[uuid.UUID, str]
) -> KbVersionRead:
    return KbVersionRead(
        id=version.id,
        number=version.number,
        title=version.title,
        body_md=version.body_md,
        sources=version.sources,
        author_id=version.author_id,
        author_name=_name(version.author_id, version.author_label, names),
        created_at=version.created_at,
        updated_at=version.updated_at,
        submitted_at=version.submitted_at,
        reviewed_by=version.reviewed_by,
        approver_name=_name(version.reviewed_by, version.approver_label, names),
        approved_at=version.approved_at,
        returned_by=version.returned_by,
        returned_by_name=_name(version.returned_by, None, names),
        returned_at=version.returned_at,
        return_comment=version.return_comment,
        source_file_name=version.source_file_name,
        content_hash=content_hash(version),
        is_live=version.id == live_id,
    )


def warnings_for(version: KbArticleVersion) -> list[KbGuardWarning]:
    return [
        KbGuardWarning(
            section=found.section,
            sentence=found.sentence,
            kind=found.kind,  # type: ignore[arg-type]
            rule=found.rule,
        )
        for found in draft_warnings(version.title, version.body_md)
    ]


def permissions(
    article: KbArticle, working: KbArticleVersion, viewer: CurrentUser
) -> KbArticlePermissions:
    if article.kind == repo.CLINICAL:
        mine = working.author_id == viewer.id
        reviewable = _awaiting_review_of(article, working, viewer)
        return KbArticlePermissions(
            edit=mine and article.status in (repo.DRAFT, repo.REVIEW),
            submit=mine and article.status == repo.DRAFT,
            publish=reviewable,
            return_to_author=reviewable,
            withdraw=article.live_version_id is not None,
            new_version=article.status in (repo.PUBLISHED, repo.WITHDRAWN),
            hide=False,
            show=False,
            discard=_may_discard(article, working, viewer),
        )
    own = article.origin == repo.CABINET
    return KbArticlePermissions(
        edit=own and article.status == repo.DRAFT,
        submit=False,
        publish=own and article.status == repo.DRAFT,
        return_to_author=False,
        withdraw=own and article.live_version_id is not None,
        new_version=own and article.status in (repo.PUBLISHED, repo.WITHDRAWN),
        hide=not own and not article.hidden,
        show=not own and article.hidden,
        discard=_may_discard(article, working, viewer),
    )


def _may_discard(article: KbArticle, working: KbArticleVersion, viewer: CurrentUser) -> bool:
    """Who may throw away the unpublished working version.

    Clinical: its author while it is a draft or on review; any other
    specialist only while it is a draft — an abandoned draft must not lock the
    article for the whole clinic, and a version on review has its own way back
    (return to the author). Product: the administrator's own draft.
    """

    if working.approved_at is not None:
        return False
    if article.kind == repo.CLINICAL:
        if working.author_id == viewer.id:
            return article.status in (repo.DRAFT, repo.REVIEW)
        return article.status == repo.DRAFT and viewer.role in (
            UserRole.DOCTOR,
            UserRole.DIETITIAN,
        )
    return article.origin == repo.CABINET and article.status == repo.DRAFT


async def detail(
    session: AsyncSession, article: KbArticle, *, viewer: CurrentUser
) -> KbArticleDetail:
    history = await repo.versions(session, article.id)
    working = history[-1]
    people = {
        person
        for version in history
        for person in (version.author_id, version.reviewed_by, version.returned_by)
        if person is not None
    }
    names = await repo.user_names(session, people)
    live = next((v for v in history if v.id == article.live_version_id), None)
    summary = _summary(article, working, live=live, names=names, viewer=viewer)
    reads = [
        _version_read(v, live_id=article.live_version_id, names=names) for v in reversed(history)
    ]
    return KbArticleDetail(
        **summary.model_dump(),
        working_version=reads[0],
        versions=reads,
        warnings=[] if working.approved_at is not None else warnings_for(working),
        can=permissions(article, working, viewer),
    )


# --- writing ----------------------------------------------------------------


def _snapshot(article: KbArticle, working: KbArticleVersion) -> dict[str, Any]:
    """Audit payload. A product article carries its text (the administrator's
    journal shows it); a clinical one only names the version — its journal
    entries are hidden from the administrator anyway, and the text lives in the
    versions table."""

    shot: dict[str, Any] = {
        "slug": article.slug,
        "title": article.title,
        "status": article.status,
        "hidden": article.hidden,
        "live_version_id": str(article.live_version_id) if article.live_version_id else None,
        "version": working.number,
        "content_hash": content_hash(working),
    }
    if article.kind == repo.PRODUCT:
        shot["body_md"] = working.body_md
        shot["sources"] = working.sources
    return shot


async def _audit(
    session: AsyncSession,
    *,
    user: CurrentUser,
    action: str,
    article: KbArticle,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    ip: str | None,
) -> None:
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action=action,
        entity=AUDIT_ENTITY[article.kind],
        entity_id=article.id,
        before=before,
        after=after,
        ip=ip,
    )


@lru_cache(maxsize=1)
def _release_names(root: str) -> frozenset[str]:
    """Names of the article files shipped with this release.

    A cabinet article never takes one: the release sync would have to skip that
    file. The files change only with a new image, so the walk is done once.
    """

    return frozenset(path.stem for path in article_paths(Path(root)))


def _slug_taken_by_release(candidate: str) -> bool:
    return candidate in _release_names(get_settings().knowledge_base_dir)


async def _slug_candidates(session: AsyncSession, title: str) -> list[str]:
    base = slug_base(title)
    free: list[str] = []
    for attempt in range(1, _SLUG_ATTEMPTS + 1):
        candidate = with_suffix(base, attempt)
        if _slug_taken_by_release(candidate) or await repo.slug_exists(session, candidate):
            continue
        free.append(candidate)
        if len(free) == _SLUG_RACE_RETRIES:
            break
    if not free:
        raise ApiError(
            ErrorCode.CONFLICT, "Статей с таким заголовком слишком много. Уточните заголовок."
        )
    return free


async def create(
    session: AsyncSession,
    *,
    kind: str,
    payload: KbArticleWrite,
    user: CurrentUser,
    ip: str | None,
) -> KbArticle:
    # The index lock serialises cabinet creates with each other and with the
    # release sync; the savepoint is the second line: a name taken between the
    # check and the insert moves on to the next suffix instead of a 500.
    await lock_index(session)
    for slug in await _slug_candidates(session, payload.title):
        try:
            async with session.begin_nested():
                article, first = await repo.create(
                    session,
                    slug=slug,
                    kind=kind,
                    origin=repo.CABINET,
                    title=payload.title,
                    body_md=payload.body_md,
                    sources=payload.sources,
                    created_by=user.id,
                    author_id=user.id,
                    source_file_name=payload.source_file_name,
                )
        except IntegrityError as error:
            if "kb_articles_slug_key" not in str(error.orig):
                raise
            continue
        await _audit(
            session,
            user=user,
            action="create",
            article=article,
            before=None,
            after=_snapshot(article, first),
            ip=ip,
        )
        return article
    raise ApiError(
        ErrorCode.CONFLICT,
        "Статью с таким заголовком только что завели. Повторите сохранение.",
    )


def _require_cabinet(article: KbArticle) -> None:
    if article.origin != repo.CABINET:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Встроенная статья меняется только с выпуском приложения. "
            "Её можно скрыть из помощника.",
        )


def _require_author(article: KbArticle, working: KbArticleVersion, user: CurrentUser) -> None:
    if article.kind == repo.CLINICAL and working.author_id != user.id:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Черновик правит только его автор. Чтобы предложить изменения, "
            "верните статью автору с комментарием.",
        )


async def update(
    session: AsyncSession,
    *,
    article: KbArticle,
    payload: KbArticleWrite,
    user: CurrentUser,
    ip: str | None,
) -> None:
    _require_cabinet(article)
    working = await repo.working_version(session, article.id, for_update=True)
    allowed = (repo.DRAFT, repo.REVIEW) if article.kind == repo.CLINICAL else (repo.DRAFT,)
    if article.status not in allowed or working.approved_at is not None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Опубликованная версия не меняется. Начните новую версию — "
            "опубликованная останется в помощнике, пока новую не опубликуют.",
            details={"status": article.status},
        )
    _require_author(article, working, user)
    before = _snapshot(article, working)
    await repo.update_draft(
        session,
        article=article,
        draft=working,
        title=payload.title,
        body_md=payload.body_md,
        sources=payload.sources,
        source_file_name=payload.source_file_name,
    )
    await _audit(
        session,
        user=user,
        action="update",
        article=article,
        before=before,
        after=_snapshot(article, working),
        ip=ip,
    )


async def submit(
    session: AsyncSession, *, article: KbArticle, user: CurrentUser, ip: str | None
) -> None:
    working = await repo.working_version(session, article.id, for_update=True)
    if article.status != repo.DRAFT:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Статья уже на проверке."
            if article.status == repo.REVIEW
            else "На проверку отправляется черновик. Начните новую версию.",
            details={"status": article.status},
        )
    _require_author(article, working, user)
    before = _snapshot(article, working)
    await repo.submit(session, article=article, draft=working)
    await _audit(
        session,
        user=user,
        action="submit",
        article=article,
        before=before,
        after=_snapshot(article, working),
        ip=ip,
    )


def _require_same_text(working: KbArticleVersion, seen_hash: str) -> None:
    if content_hash(working) != seen_hash:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Текст статьи изменился, пока вы его читали. Откройте статью заново "
            "и примите решение по новому тексту.",
            details={"reason": "content_changed"},
        )


async def publish(
    session: AsyncSession,
    *,
    article: KbArticle,
    seen_hash: str,
    user: CurrentUser,
    ip: str | None,
) -> None:
    working = await repo.working_version(session, article.id, for_update=True)
    if article.kind == repo.CLINICAL:
        if article.status != repo.REVIEW:
            raise ApiError(
                ErrorCode.CONFLICT,
                "Опубликовать можно только статью, отправленную на проверку.",
                details={"status": article.status},
            )
        if working.author_id == user.id:
            raise ApiError(
                ErrorCode.CONFLICT,
                "Свою версию опубликовать нельзя: клиническую статью публикует "
                "другой специалист — врач или диетолог, который её проверил.",
                details={"reason": "four_eyes"},
            )
    else:
        _require_cabinet(article)
        if article.status != repo.DRAFT:
            raise ApiError(
                ErrorCode.CONFLICT,
                "Опубликовать можно только черновик.",
                details={"status": article.status},
            )
    _require_same_text(working, seen_hash)

    before = _snapshot(article, working)
    await repo.publish(session, article=article, draft=working, reviewed_by=user.id)
    await reindex_article(session, article)
    await _audit(
        session,
        user=user,
        action="publish",
        article=article,
        before=before,
        after=_snapshot(article, working),
        ip=ip,
    )


async def return_to_author(
    session: AsyncSession,
    *,
    article: KbArticle,
    seen_hash: str,
    comment: str,
    user: CurrentUser,
    ip: str | None,
) -> None:
    working = await repo.working_version(session, article.id, for_update=True)
    if article.status != repo.REVIEW:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Вернуть автору можно только статью на проверке.",
            details={"status": article.status},
        )
    if working.author_id == user.id:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Свою версию не возвращают себе: правьте её — она снова станет черновиком.",
            details={"reason": "four_eyes"},
        )
    _require_same_text(working, seen_hash)
    before = _snapshot(article, working)
    await repo.return_to_author(
        session, article=article, draft=working, reviewer_id=user.id, comment=comment
    )
    after = _snapshot(article, working)
    after["return_comment"] = comment
    await _audit(
        session, user=user, action="return", article=article, before=before, after=after, ip=ip
    )


async def withdraw(
    session: AsyncSession, *, article: KbArticle, user: CurrentUser, ip: str | None
) -> None:
    if article.kind == repo.PRODUCT:
        _require_cabinet(article)
    if article.live_version_id is None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Статьи и так нет в помощнике.",
            details={"status": article.status},
        )
    working = await repo.working_version(session, article.id)
    before = _snapshot(article, working)
    await repo.withdraw(session, article=article)
    await reindex_article(session, article)
    await _audit(
        session,
        user=user,
        action="withdraw",
        article=article,
        before=before,
        after=_snapshot(article, working),
        ip=ip,
    )


async def new_version(
    session: AsyncSession, *, article: KbArticle, user: CurrentUser, ip: str | None
) -> None:
    if article.kind == repo.PRODUCT:
        _require_cabinet(article)
    if article.status not in (repo.PUBLISHED, repo.WITHDRAWN):
        raise ApiError(
            ErrorCode.CONFLICT,
            "У статьи уже есть неопубликованная версия — продолжите её.",
            details={"status": article.status},
        )
    working = await repo.working_version(session, article.id, for_update=True)
    before = _snapshot(article, working)
    added = await repo.add_version(
        session,
        article=article,
        number=working.number + 1,
        title=working.title,
        body_md=working.body_md,
        sources=working.sources,
        author_id=user.id,
    )
    await _audit(
        session,
        user=user,
        action="new_version",
        article=article,
        before=before,
        after=_snapshot(article, added),
        ip=ip,
    )


async def set_hidden(
    session: AsyncSession, *, article: KbArticle, hidden: bool, user: CurrentUser, ip: str | None
) -> None:
    if article.origin != repo.BUILTIN:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Скрыть можно встроенную статью. Свою статью снимите из помощника.",
        )
    if article.hidden == hidden:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Статья уже скрыта из помощника." if hidden else "Статья и так видна помощнику.",
        )
    working = await repo.working_version(session, article.id)
    before = _snapshot(article, working)
    await repo.set_hidden(session, article=article, hidden=hidden)
    await reindex_article(session, article)
    after = _snapshot(article, working)
    # Two literal calls, not a conditional expression: the audit filter test
    # collects written actions from `action="…"` literals.
    if hidden:
        await _audit(
            session, user=user, action="hide", article=article, before=before, after=after, ip=ip
        )
    else:
        await _audit(
            session, user=user, action="show", article=article, before=before, after=after, ip=ip
        )


async def discard_draft(
    session: AsyncSession, *, article: KbArticle, user: CurrentUser, ip: str | None
) -> bool:
    """Throw away the unpublished working version. True when the article itself
    is gone — it had never been published, and the draft was all of it.

    Without this an «Изменить» clicked by mistake, or a colleague's abandoned
    draft, locked the article: only its author could edit it, and nobody could
    start another version. The published versions stay as they were; the text
    of the discarded one is kept in the journal entry.
    """

    if article.kind == repo.PRODUCT:
        _require_cabinet(article)
    working = await repo.working_version(session, article.id, for_update=True)
    if working.approved_at is not None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Неопубликованной версии нет — удалять нечего.",
            details={"status": article.status},
        )
    if not _may_discard(article, working, user):
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Версию на проверке удаляет только её автор. Чтобы вернуть её "
            "в работу, верните статью автору с комментарием.",
            details={"status": article.status},
        )
    before = _snapshot(article, working)
    before["body_md"] = working.body_md
    before["sources"] = working.sources
    deleted = await repo.discard_draft(session, article=article, draft=working)
    after = None if deleted else _snapshot(article, await repo.working_version(session, article.id))
    await _audit(
        session,
        user=user,
        action="discard_draft",
        article=article,
        before=before,
        after=after,
        ip=ip,
    )
    return deleted
