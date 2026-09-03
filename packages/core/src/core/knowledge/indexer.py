"""Пересборка индекса базы знаний из файлов (раздел 10.4 ТЗ).

Индекс производен от git: файлы — истина, таблица — то, по чему ищут. Поэтому
индексация идемпотентна и полна: что исчезло из файлов, исчезает из индекса,
иначе помощник продолжал бы цитировать отозванную статью.

Чернового статуса в индексе нет вовсе: `draft` отсеивается здесь, а не в
промпте. Неутверждённый текст не должен физически доезжать до модели.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import KbChunk
from .documents import Article, ArticleError, read_article, split_article


def _collect(root: Path) -> tuple[list[Article], list[str], int]:
    """Прочитать и проверить все статьи каталога. Синхронно, без БД."""

    articles: list[Article] = []
    errors: list[str] = []
    drafts = 0

    for path in sorted(root.rglob("*.md")):
        if path.name == "README.md":
            continue
        try:
            article = read_article(path, root=root)
        except ArticleError as error:
            # Ошибка одной статьи не отменяет остальные, но и не прощается:
            # отчёт возвращает её, а вызывающий решает, падать ли.
            errors.append(str(error))
            continue
        if article.status != "approved":
            drafts += 1
            continue
        articles.append(article)

    return articles, errors, drafts


@dataclass(frozen=True, slots=True)
class IndexReport:
    documents: int
    chunks: int
    skipped_drafts: int
    removed: int
    errors: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not self.errors


async def reindex(session: AsyncSession, *, root: Path) -> IndexReport:
    """Собрать индекс заново по каталогу базы знаний."""

    # Чтение файлов — в отдельном потоке: диск не должен занимать цикл событий,
    # и то же правило уже действует в ночной уборке файлов (`maintenance.py`).
    articles, errors, drafts = await asyncio.to_thread(_collect, root)

    keep = {article.slug for article in articles}
    existing = set((await session.scalars(select(KbChunk.doc_slug).distinct())).all())

    removed = 0
    for slug in existing - keep:
        result = await session.execute(delete(KbChunk).where(KbChunk.doc_slug == slug))
        removed += int(getattr(result, "rowcount", 0) or 0)

    chunks = 0
    for article in articles:
        # Статья пересобирается целиком: сравнивать куски по одному дороже, чем
        # переписать десяток строк, а расхождение обошлось бы дороже обоих.
        await session.execute(delete(KbChunk).where(KbChunk.doc_slug == article.slug))
        for chunk in split_article(article):
            session.add(
                KbChunk(
                    doc_slug=article.slug,
                    doc_title=article.title,
                    heading_path=chunk.heading_path,
                    ord=chunk.ord,
                    body=chunk.body,
                    kind=article.kind,
                    source_path=article.path,
                    source_sha256=article.sha256,
                )
            )
            chunks += 1

    await session.flush()
    return IndexReport(
        documents=len(articles),
        chunks=chunks,
        skipped_drafts=drafts,
        removed=removed,
        errors=tuple(errors),
    )
