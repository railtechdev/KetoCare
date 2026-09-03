"""Поиск по базе знаний помощника (раздел 10.4 ТЗ).

Полнотекст PostgreSQL с русской морфологией, тот же приём, что в справочнике
продуктов: семья спрашивает живыми словами («а куда кетоны вписывать?»), и
поиск обязан находить статью по любой словоформе.

Пустой результат — валидный ответ, а не ошибка. Он означает, что говорить не о
чем: помощник в этом случае не вызывает модель вовсе и отвечает шаблоном.
"""

from __future__ import annotations

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
