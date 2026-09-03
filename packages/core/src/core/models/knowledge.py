"""Куски базы знаний помощника (раздел 10.4 ТЗ).

Таблица — не источник истины, а производный индекс. Истина лежит в git:
`docs/knowledge-base/**.md`, клиническую половину подписывает медицинская
команда. Отсюда два следствия, которые определяют всю форму таблицы:

- строки пересобираются индексатором из файлов и никем не правятся руками;
- у каждого куска хранится `source_path` и `source_sha256` — по ним видно, из
  какого файла и какой его версии кусок собран, и можно переиндексировать
  только изменившееся.

Поиск — встроенный полнотекст PostgreSQL с русской морфологией: «кетонов» и
«кетоны» обязаны находить одну и ту же статью, а вопрос семья задаёт живыми
словами. Тот же приём, что в справочнике продуктов.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Computed, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDPkMixin


class KbChunk(Base, UUIDPkMixin):
    __tablename__ = "kb_chunks"
    __table_args__ = (
        # Порядок куска внутри статьи уникален: пересборка статьи заменяет
        # куски, а не добавляет вторые с тем же номером.
        UniqueConstraint("doc_slug", "ord", name="uq_kb_chunks_doc_ord"),
        Index("ix_kb_chunks_search", "search_tsv", postgresql_using="gin"),
    )

    #: Имя файла без расширения. Оно же `id` в заголовке статьи и то, чем
    #: помощник ссылается на источник в ответе.
    doc_slug: Mapped[str] = mapped_column(String(128), nullable=False)
    doc_title: Mapped[str] = mapped_column(String(255), nullable=False)
    #: Путь заголовков до куска: «Как записать кетоны › Подробно». Показывается
    #: модели вместе с текстом — без него кусок теряет контекст.
    heading_path: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    ord: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    #: `product` или `clinical`. Хранится, чтобы ответ мог сказать, кто отвечает
    #: за содержание, и чтобы клиническую часть можно было отключить целиком.
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    source_path: Mapped[str] = mapped_column(String(512), nullable=False)
    source_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    indexed_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())

    #: Взвешенный вектор: заголовок статьи важнее пути заголовков, путь важнее
    #: тела. Генерируемый столбец, а не выражение в запросе: одно и то же
    #: трёхчастное выражение, повторённое в каждом запросе, однажды разъедется.
    search_tsv: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed(
            "setweight(to_tsvector('russian', coalesce(doc_title, '')), 'A') || "
            "setweight(to_tsvector('russian', coalesce(heading_path, '')), 'B') || "
            "setweight(to_tsvector('russian', coalesce(body, '')), 'C')",
            persisted=True,
        ),
        nullable=False,
    )
