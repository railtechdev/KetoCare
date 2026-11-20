"""Поиск по базе знаний помощника (раздел 10.4 ТЗ).

Полнотекст PostgreSQL с русской морфологией, тот же приём, что в справочнике
продуктов: семья спрашивает живыми словами («а куда кетоны вписывать?»), и
поиск обязан находить статью по любой словоформе.

Пустой результат — валидный ответ, а не ошибка. Он означает, что говорить не о
чем: помощник в этом случае не вызывает модель вовсе и отвечает шаблоном.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, column, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import KbChunk

#: Порог соответствия для нестрогого прохода.
#:
#: Он там и нужен: поиск через ИЛИ находит статью по ОДНОМУ случайному слову.
#: Замер на живых вопросах: настоящее попадание даёт 1.4-1.8, а «рецепт торта на
#: день рождения» цеплялось за статью о Telegram через слово «день» с 0.20.
#: Пустая выдача честнее случайной: на ней помощник не вызывает модель вовсе.
MIN_LOOSE_RANK = 0.5


@dataclass(frozen=True, slots=True)
class Passage:
    """Кусок статьи вместе с тем, откуда он взят."""

    doc_slug: str
    doc_title: str
    heading_path: str
    body: str
    kind: str
    rank: float


async def search(session: AsyncSession, *, q: str, limit: int = 6) -> list[Passage]:
    """Куски, подходящие вопросу, — по убыванию соответствия.

    Два прохода, и второй обязателен. `websearch_to_tsquery` соединяет слова
    через И: живой вопрос «куда вписать кетоны» не находил НИЧЕГО, потому что
    «вписать» в статье нет — там «записать». Строгий проход даёт точность и
    идёт первым; когда он пуст, тот же вопрос ищется через ИЛИ по тем же
    лексемам, и статья находится по слову «кетоны».

    Лексемы берёт сама база (`to_vector` + `unnest`): разбирать русскую
    морфологию на стороне приложения значит завести второй, худший
    стеммер — и он разойдётся с тем, по которому построен индекс.
    """

    query = q.strip()
    if not query:
        return []

    strict = await _search_with(session, func.websearch_to_tsquery("russian", query), limit=limit)
    if strict:
        return strict

    loose = await _search_with(session, _any_word_query(query), limit=limit)
    return [passage for passage in loose if passage.rank >= MIN_LOOSE_RANK]


def _any_word_query(query: str) -> ColumnElement[Any]:
    """`to_tsquery` из лексем вопроса, соединённых через ИЛИ.

    Лексемы экранируются: без `quote_literal` слово с апострофом или дефисом
    ломает разбор запроса, и поиск падает вместо того, чтобы ничего не найти.
    """

    lexemes = (
        select(func.string_agg(func.quote_literal(column("lexeme")), text("' | '")))
        .select_from(func.unnest(func.to_tsvector("russian", query)).alias("t"))
        .scalar_subquery()
    )
    return func.to_tsquery("russian", func.coalesce(lexemes, ""))


async def _search_with(
    session: AsyncSession, tsquery: ColumnElement[Any], *, limit: int
) -> list[Passage]:
    rank = func.ts_rank_cd(KbChunk.search_tsv, tsquery)

    rows = (
        await session.execute(
            select(
                KbChunk.doc_slug,
                KbChunk.doc_title,
                KbChunk.heading_path,
                KbChunk.body,
                KbChunk.kind,
                rank.label("rank"),
            )
            .where(KbChunk.search_tsv.op("@@")(tsquery))
            .order_by(rank.desc(), KbChunk.doc_slug, KbChunk.ord)
            .limit(limit)
        )
    ).all()

    return [
        Passage(
            doc_slug=row.doc_slug,
            doc_title=row.doc_title,
            heading_path=row.heading_path,
            body=row.body,
            kind=row.kind,
            rank=float(row.rank),
        )
        for row in rows
    ]


async def count_chunks(session: AsyncSession) -> int:
    """Сколько кусков в индексе. Ноль означает, что помощнику нечем отвечать."""

    total = await session.scalar(select(func.count()).select_from(KbChunk))
    return int(total or 0)


async def titles_for(session: AsyncSession, slugs: list[str]) -> dict[str, str]:
    """Заголовки статей по их именам — для ссылок «по материалам» в переписке.

    Ответ помощника хранит имя статьи (`doc_slug`): им модель ссылается на
    источник, и оно не меняется при правке заголовка. Человеку же нужен
    заголовок — «how-to-plan-the-day» под ответом читается как поломка.
    Статьи, которой в индексе больше нет, в ответе нет: ссылка на неё никуда
    не ведёт.
    """

    if not slugs:
        return {}
    rows = await session.execute(
        select(KbChunk.doc_slug, KbChunk.doc_title)
        .where(KbChunk.doc_slug.in_(set(slugs)))
        .distinct()
    )
    return {row.doc_slug: row.doc_title for row in rows}


#: Separator between the article title and the section heading in
#: `heading_path` — the one `knowledge.documents.split_article` writes.
HEADING_SEPARATOR = " › "


@dataclass(frozen=True, slots=True)
class KbArticle:
    """One article as the assistant read it: the indexed sections in order."""

    slug: str
    title: str
    kind: str
    body_md: str


async def article(session: AsyncSession, slug: str) -> KbArticle | None:
    """The article behind a source link under an assistant reply, or None.

    Assembled from the index, not read from the file: the index is what the
    assistant actually quoted, and a draft or withdrawn article — absent from
    the index — is absent here too.
    """

    chunks = (
        await session.scalars(select(KbChunk).where(KbChunk.doc_slug == slug).order_by(KbChunk.ord))
    ).all()
    if not chunks:
        return None
    first = chunks[0]
    return KbArticle(
        slug=first.doc_slug,
        title=first.doc_title,
        kind=first.kind,
        body_md=_reassemble(first.doc_title, [(c.heading_path, c.body) for c in chunks]),
    )


def _reassemble(title: str, sections: list[tuple[str, str]]) -> str:
    """Markdown of the article body from its sections, without the title.

    The indexer cuts an article at its headings and keeps the heading as
    `Title › Heading`; each section turns back into `## Heading` and its text.
    The title itself (the file's H1) is left out: it travels as its own field
    and the screen prints it as the page heading. A section whose path is the
    bare title is an article without `##` sections: the indexer keeps its whole
    body, H1 included, so the leading H1 line is dropped here — otherwise the
    sheet showed the title twice. Articles use only `##` under the title, so
    every heading is restored at that level.
    """

    prefix = f"{title}{HEADING_SEPARATOR}"
    parts: list[str] = []
    for heading_path, body in sections:
        if heading_path.startswith(prefix):
            parts.append(f"## {heading_path.removeprefix(prefix)}\n\n{body.strip()}")
        else:
            parts.append(_LEADING_H1.sub("", body.strip(), count=1).strip())
    return "\n\n".join(part for part in parts if part)


#: The file's H1 at the very start of a section body.
_LEADING_H1 = re.compile(r"\A#[ \t]+[^\n]*(?:\n|\Z)")
