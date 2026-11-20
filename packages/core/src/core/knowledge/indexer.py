"""Статьи из файлов выпуска и индекс помощника (раздел 10.4 ТЗ, ADR-0093).

С ADR-0093 истина о статьях — в таблицах `kb_articles` / `kb_article_versions`,
а `kb_chunks` — производный индекс, по которому ищет помощник. Файлы
`docs/knowledge-base` остаются источником в двух ролях, и роли разные:

- **встроенные продуктовые статьи** (`product/`) приезжают с каждым выпуском и
  правятся разработкой. Новая — добавляется опубликованной; изменившаяся —
  получает новую опубликованную редакцию (скрытая администратором остаётся
  скрытой); исчезнувшая из выпуска — снимается;
- **клинические статьи** (`clinical/`) переносятся в кабинет ОДИН раз — первым
  прогоном, после которого в базе есть хоть одна перенесённая статья. Дальше их
  ведут специалисты в кабинете: выпуск, принёсший другой текст того же файла,
  их не трогает (иначе правка врача молча откатывалась бы при выкате), а НОВЫЙ
  файл в `clinical/` не публикуется вовсе — отчёт называет его, и статью
  заводят в кабинете, где её публикует второй специалист. Иначе каталог
  `clinical/` оставался бы постоянным каналом публикации мимо четырёх глаз.

Каталог задаёт вид: `kind: clinical` вне `clinical/` и `kind: product` вне
`product/` — ошибка разбора (`documents.read_article`), а не перенос.

Статей, заведённых в кабинете, синхронизация не касается вовсе. Совпадение
имени у файла и статьи кабинета — пропуск файла с предупреждением в отчёте, а
не перезапись и не остановка выката: имя статьи кабинета выбирали люди в
кабинете, и выпуск, о ней не знающий, не должен из-за неё падать на стенде.

Синхронизация и любая запись статьи в кабинете берут одну и ту же
транзакционную блокировку (`lock_index`): иначе статья, снятая врачом посреди
выката, возвращалась бы в помощник из устаревшего объекта сессии индексатора.

Индекс собирается только из живой редакции опубликованной и не скрытой статьи.
Чернового статуса в индексе нет вовсе: неутверждённый текст не должен физически
доезжать до модели. Всё идемпотентно: второй прогон по тем же файлам не меняет
ни одной строки.
"""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time
from pathlib import Path

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import KbArticle, KbArticleVersion, KbChunk
from ..repositories import audit as audit_repo
from ..repositories import kb_articles as articles_repo
from .documents import Article, ArticleError, article_paths, read_article, split_text

#: Автор и утвердивший у редакций, приехавших с выпуском.
RELEASE_LABEL = "KetoCare"

#: Записи журнала. Клинические статьи пишутся под своей сущностью, нагрузку
#: которой журнал администратора не показывает (правило 5 CLAUDE.md: к
#: клиническому содержанию у администратора доступа нет).
AUDIT_ENTITY = {
    articles_repo.CLINICAL: "kb_clinical_articles",
    articles_repo.PRODUCT: "kb_product_articles",
}


#: Ключ транзакционной блокировки индекса помощника (`pg_advisory_xact_lock`).
#: Число произвольное, но постоянное и меньше 2**31: в `pg_locks` оно видно
#: как `objid` при нулевом `classid`.
INDEX_LOCK_KEY = 93_000_093


async def lock_index(session: AsyncSession) -> None:
    """Взять блокировку индекса до конца транзакции.

    Её берут синхронизация с выпуском — до первого чтения статей — и каждая
    запись статьи в кабинете — до блокировки строки статьи. Порядок один
    (сначала эта, потом строки), поэтому взаимной блокировки нет, а
    публикация, снятие или скрытие, пришедшие во время выката, ждут его
    фиксации и читают статью уже после неё.
    """

    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": INDEX_LOCK_KEY})


def _collect(root: Path) -> tuple[list[Article], list[str], int]:
    """Прочитать и проверить все статьи каталога. Синхронно, без БД."""

    articles: list[Article] = []
    errors: list[str] = []
    drafts = 0
    seen: dict[str, str] = {}

    for path in article_paths(root):
        try:
            article = read_article(path, root=root)
        except ArticleError as error:
            # Ошибка одной статьи не прощается: отчёт возвращает её, и ничего
            # не пишется — половинчатая синхронизация хуже прежней.
            errors.append(str(error))
            continue
        if article.slug in seen:
            errors.append(f"{path.name}: id «{article.slug}» уже занят {seen[article.slug]}")
            continue
        seen[article.slug] = path.name
        if article.status != "approved":
            drafts += 1
            continue
        articles.append(article)

    return articles, errors, drafts


@dataclass(slots=True)
class IndexReport:
    #: Утверждённых статей в файлах.
    documents: int
    #: Кусков записано в индекс этим прогоном.
    chunks: int
    skipped_drafts: int
    #: Кусков убрано из индекса этим прогоном.
    removed: int
    errors: tuple[str, ...]
    builtin_added: int = 0
    builtin_updated: int = 0
    builtin_withdrawn: int = 0
    clinical_imported: int = 0
    #: Статей в индексе после прогона — то, чем помощник может отвечать.
    live_articles: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def _approved_at(article: Article) -> datetime | str:
    """Дата подписи клинической статьи или текст ошибки."""

    try:
        day = date.fromisoformat((article.approved_at or "").strip())
    except ValueError:
        return f"{Path(article.path).name}: approved_at — дата вида ГГГГ-ММ-ДД"
    return datetime.combine(day, time(), tzinfo=UTC)


async def _clinical_import_done(session: AsyncSession) -> bool:
    """Перенос клинических файлов уже был: в базе есть перенесённая редакция.

    Перенесённую редакцию отличает автор: у неё нет пользователя, только
    подпись выпуска. Редакции кабинета всегда пишет человек.
    """

    found = await session.scalar(
        select(KbArticleVersion.id)
        .join(KbArticle, KbArticle.id == KbArticleVersion.article_id)
        .where(
            KbArticle.kind == articles_repo.CLINICAL,
            KbArticleVersion.author_id.is_(None),
            KbArticleVersion.author_label == RELEASE_LABEL,
        )
        .limit(1)
    )
    return found is not None


async def reindex(session: AsyncSession, *, root: Path) -> IndexReport:
    """Синхронизировать статьи с файлами выпуска и собрать индекс.

    Пишет в сессию, но не фиксирует: при ошибке вызывающий откатывает, и
    остаётся прежнее состояние.
    """

    # Блокировка — до первого чтения: всё, что прочитано ниже, не изменится
    # чужой записью статьи до фиксации этой транзакции.
    await lock_index(session)

    # Чтение файлов — в отдельном потоке: диск не должен занимать цикл событий,
    # и то же правило уже действует в ночной уборке файлов (`maintenance.py`).
    articles, errors, drafts = await asyncio.to_thread(_collect, root)
    report = IndexReport(
        documents=len(articles), chunks=0, skipped_drafts=drafts, removed=0, errors=()
    )

    stored = await articles_repo.by_slug(session)
    import_open = not await _clinical_import_done(session)
    to_import: list[Article] = []
    shipped: set[str] = set()
    builtin: list[Article] = []
    for article in articles:
        name = Path(article.path).name
        existing = stored.get(article.slug)
        if article.kind == articles_repo.PRODUCT:
            if existing is not None and existing.origin != articles_repo.BUILTIN:
                report.notes.append(
                    f"{name}: имя «{article.slug}» занято статьёй кабинета "
                    f"({existing.kind}) — встроенная статья не добавлена, переименуйте файл"
                )
                continue
            shipped.add(article.slug)
            builtin.append(article)
        elif existing is not None:
            # Статья уже в базе — истина там. Чужая (продуктовая) — называется.
            if existing.kind != articles_repo.CLINICAL:
                report.notes.append(
                    f"{name}: имя «{article.slug}» занято продуктовой статьёй — "
                    "клиническая статья не перенесена"
                )
        elif not import_open:
            report.notes.append(
                f"{name}: клинические статьи ведутся в кабинете, файл не перенесён — "
                "заведите статью в разделе «Статьи для семей»"
            )
        else:
            approved = _approved_at(article)
            if isinstance(approved, str):
                errors.append(approved)
            to_import.append(article)
    if errors:
        report.errors = tuple(errors)
        return report

    for article in builtin:
        await _sync_builtin(session, article, stored.get(article.slug), report)
    for article in to_import:
        await _import_clinical(session, article, report)

    for slug, existing in stored.items():
        if (
            existing.origin == articles_repo.BUILTIN
            and slug not in shipped
            and existing.live_version_id is not None
        ):
            await articles_repo.withdraw(session, article=existing)
            await _audit(session, existing, action="release_withdraw")
            report.builtin_withdrawn += 1

    written, removed, live = await rebuild_index(session)
    report.chunks, report.removed, report.live_articles = written, removed, live
    return report


async def _sync_builtin(
    session: AsyncSession, file: Article, existing: KbArticle | None, report: IndexReport
) -> None:
    if existing is None:
        article, first = await articles_repo.create(
            session,
            slug=file.slug,
            kind=articles_repo.PRODUCT,
            origin=articles_repo.BUILTIN,
            title=file.title,
            body_md=file.body,
            sources=file.source,
            created_by=None,
            author_id=None,
            author_label=RELEASE_LABEL,
            source_file_name=file.path,
        )
        await articles_repo.publish(
            session, article=article, draft=first, reviewed_by=None, approver_label=RELEASE_LABEL
        )
        await _audit(session, article, action="release_add")
        report.builtin_added += 1
        return

    latest = await articles_repo.working_version(session, existing.id)
    same_text = (latest.title, latest.body_md, latest.sources) == (
        file.title,
        file.body,
        file.source,
    )
    if same_text and latest.approved_at is not None:
        if existing.live_version_id != latest.id:
            # Файл вернулся в выпуск тем же текстом: прежняя редакция снова живая.
            await articles_repo.make_live(session, article=existing, live=latest)
            await _audit(session, existing, action="release_restore")
            report.builtin_updated += 1
        return

    added = await articles_repo.add_version(
        session,
        article=existing,
        number=latest.number + 1,
        title=file.title,
        body_md=file.body,
        sources=file.source,
        author_id=None,
        author_label=RELEASE_LABEL,
        source_file_name=file.path,
    )
    await articles_repo.publish(
        session, article=existing, draft=added, reviewed_by=None, approver_label=RELEASE_LABEL
    )
    await _audit(session, existing, action="release_update")
    report.builtin_updated += 1


async def _import_clinical(session: AsyncSession, file: Article, report: IndexReport) -> None:
    approved_at = _approved_at(file)
    assert isinstance(approved_at, datetime)  # проверено в `_conflicts`
    article, first = await articles_repo.create(
        session,
        slug=file.slug,
        kind=articles_repo.CLINICAL,
        origin=articles_repo.CABINET,
        title=file.title,
        body_md=file.body,
        sources=file.source,
        created_by=None,
        author_id=None,
        author_label=RELEASE_LABEL,
        source_file_name=file.path,
    )
    await articles_repo.publish(
        session,
        article=article,
        draft=first,
        reviewed_by=None,
        approver_label=file.approved_by,
        approved_at=approved_at,
    )
    await _audit(session, article, action="import")
    report.clinical_imported += 1


async def _audit(session: AsyncSession, article: KbArticle, *, action: str) -> None:
    await audit_repo.write_audit_log(
        session,
        user_id=None,
        action=action,
        entity=AUDIT_ENTITY[article.kind],
        entity_id=article.id,
        after={"slug": article.slug, "status": article.status},
    )


async def rebuild_index(session: AsyncSession) -> tuple[int, int, int]:
    """Привести индекс в соответствие со статьями: (записано, убрано, живых)."""

    written = removed = live = 0
    # `populate_existing`: статьи, уже загруженные в эту сессию, перечитываются
    # из базы. Без него SQLAlchemy вернул бы объекты из карты идентичности с
    # прежними `live_version_id` и `hidden`, и индекс собрался бы по ним.
    query = select(KbArticle).order_by(KbArticle.slug).execution_options(populate_existing=True)
    for article in (await session.scalars(query)).all():
        added, dropped = await reindex_article(session, article)
        written += added
        removed += dropped
        if article.live_version_id is not None and not article.hidden:
            live += 1
    return written, removed, live


def _source_path(article: KbArticle, version: KbArticleVersion) -> str:
    if article.origin == articles_repo.BUILTIN and version.source_file_name:
        return version.source_file_name
    return f"kb:{article.slug}/v{version.number}"


async def reindex_article(session: AsyncSession, article: KbArticle) -> tuple[int, int]:
    """Куски одной статьи — по её живой редакции: (записано, убрано).

    Зовётся публикацией, снятием и скрытием в той же транзакции: помощник
    видит изменение сразу, а не после следующего выката. Если куски уже
    собраны из той же редакции тем же разрезом, ничего не пишется.
    """

    existing = list(
        (
            await session.scalars(
                select(KbChunk).where(KbChunk.article_id == article.id).order_by(KbChunk.ord)
            )
        ).all()
    )
    live_id = None if article.hidden else article.live_version_id
    if live_id is None:
        if existing:
            await session.execute(delete(KbChunk).where(KbChunk.article_id == article.id))
        return 0, len(existing)

    version = await session.get(KbArticleVersion, live_id)
    assert version is not None  # внешний ключ
    wanted = split_text(version.title, version.body_md)
    current = [
        (chunk.ord, chunk.heading_path, chunk.body, chunk.version_id, chunk.doc_title)
        for chunk in existing
    ]
    if current == [
        (piece.ord, piece.heading_path, piece.body, version.id, version.title) for piece in wanted
    ] and all(chunk.doc_slug == article.slug and chunk.kind == article.kind for chunk in existing):
        return 0, 0

    # Статья пересобирается целиком: сравнивать куски по одному дороже, чем
    # переписать десяток строк, а расхождение обошлось бы дороже обоих.
    if existing:
        await session.execute(delete(KbChunk).where(KbChunk.article_id == article.id))
        await session.flush()
    digest = hashlib.sha256(version.body_md.encode("utf-8")).hexdigest()
    for piece in wanted:
        session.add(
            KbChunk(
                article_id=article.id,
                version_id=version.id,
                doc_slug=article.slug,
                doc_title=version.title,
                heading_path=piece.heading_path,
                ord=piece.ord,
                body=piece.body,
                kind=article.kind,
                source_path=_source_path(article, version),
                source_sha256=digest,
            )
        )
    await session.flush()
    return len(wanted), len(existing)
