"""База знаний помощника: статьи, их версии и поисковый индекс (раздел 10.4 ТЗ).

С ADR-0093 истина — в базе, а не в git:

- `kb_articles` — статья: постоянное имя (`slug`, им помощник ссылается на
  источник, и переписки хранят именно его), вид, происхождение и состояние;
- `kb_article_versions` — каждая редакция. Опубликованная редакция не меняется
  и не удаляется (как назначения, правило 4 CLAUDE.md): правка опубликованной
  статьи — новая редакция, а прежняя остаётся видна помощнику, пока новую не
  опубликуют;
- `kb_chunks` — производный индекс. Его строки собираются только из ЖИВОЙ
  редакции опубликованной и не скрытой статьи и никем не правятся руками.

Клинические статьи пишут и публикуют врач и диетолог, и публикует всегда не
автор редакции (четыре глаза). Продуктовые статьи бывают встроенные — они
приезжают с выпуском из `docs/knowledge-base/product` — и свои, заведённые
администратором.

Поиск — встроенный полнотекст PostgreSQL с русской морфологией: «кетонов» и
«кетоны» обязаны находить одну и ту же статью, а вопрос семья задаёт живыми
словами. Тот же приём, что в справочнике продуктов.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
    false,
    func,
    select,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, UpdatedAtMixin, UUIDPkMixin

#: Виды статей. `clinical` — болезнь, диета, симптомы: пишут и подписывают
#: специалисты клиники. `product` — как устроено приложение.
KB_KINDS = ("clinical", "product")

#: Откуда статья. `builtin` приезжает с выпуском из файлов репозитория и
#: правится разработкой; `cabinet` заведена в кабинете (или однажды перенесена
#: туда из файла, как клинические статьи при переходе — ADR-0093).
KB_ORIGINS = ("builtin", "cabinet")

#: Состояние РАБОЧЕЙ редакции статьи — последней по номеру:
#: `draft` — пишется; `review` — ждёт проверки; `published` — опубликована и
#: она же живая; `withdrawn` — опубликована, но снята. Живая ли статья вообще,
#: говорит `live_version_id`: у черновика правки опубликованной статьи живой
#: остаётся прежняя редакция.
KB_STATUSES = ("draft", "review", "published", "withdrawn")


class KbArticle(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "kb_articles"
    __table_args__ = (
        CheckConstraint("kind IN ('clinical', 'product')", name="kb_articles_kind_known"),
        CheckConstraint("origin IN ('builtin', 'cabinet')", name="kb_articles_origin_known"),
        CheckConstraint(
            "status IN ('draft', 'review', 'published', 'withdrawn')",
            name="kb_articles_status_known",
        ),
        # Встроенными бывают только продуктовые статьи: клиническую пишет и
        # подписывает клиника, и выпуск приложения её не меняет.
        CheckConstraint(
            "origin = 'cabinet' OR kind = 'product'", name="kb_articles_builtin_is_product"
        ),
        # Скрыть можно только встроенную статью: свою администратор снимает.
        CheckConstraint("NOT hidden OR origin = 'builtin'", name="kb_articles_hidden_builtin"),
        CheckConstraint(
            "status <> 'published' OR live_version_id IS NOT NULL",
            name="kb_articles_published_is_live",
        ),
        CheckConstraint(
            "status <> 'withdrawn' OR live_version_id IS NULL",
            name="kb_articles_withdrawn_is_not_live",
        ),
    )

    #: Постоянное имя: им модель ссылается на источник (`[[kb:slug]]`), и
    #: переписки хранят его. Задаётся один раз при создании и не меняется.
    slug: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Встроенная статья, убранная администратором из помощника. Выпуск её не
    #: возвращает: новая редакция из файла приезжает, но остаётся скрытой.
    hidden: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    #: Заголовок рабочей редакции — для перечня.
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    #: Кто завёл. Пусто у встроенных и перенесённых из файлов.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    #: Редакция, которую читает помощник. Пусто — статьи в помощнике нет.
    live_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("kb_article_versions.id", use_alter=True, name="fk_kb_articles_live_version"),
        nullable=True,
    )


class KbArticleVersion(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    """Одна редакция статьи. Опубликованная (`approved_at` задан) неизменна."""

    __tablename__ = "kb_article_versions"
    __table_args__ = (
        UniqueConstraint("article_id", "number", name="uq_kb_article_versions_number"),
        CheckConstraint(
            "author_id IS NOT NULL OR author_label IS NOT NULL",
            name="kb_article_versions_author_named",
        ),
        CheckConstraint(
            "approved_at IS NULL OR reviewed_by IS NOT NULL OR approver_label IS NOT NULL",
            name="kb_article_versions_approver_named",
        ),
    )

    article_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("kb_articles.id"), nullable=False, index=True
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body_md: Mapped[str] = mapped_column(Text, nullable=False)
    #: Источники текста — ссылки на руководства, из которых он взят.
    sources: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    #: Автор словами — у редакций из файлов: «KetoCare».
    author_label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: Кто опубликовал. У клинической статьи — не автор редакции.
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    #: Утвердивший словами — у перенесённых из файлов: «Клиника».
    approver_label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    returned_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: Почему проверяющий вернул редакцию автору.
    return_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Файл, из которого взят текст: загруженный Word или путь в репозитории.
    source_file_name: Mapped[str | None] = mapped_column(String(512), nullable=True)


class PublishedVersionImmutableError(RuntimeError):
    """Попытка изменить или удалить опубликованную редакцию статьи."""


def _was_published(connection: Connection, target: KbArticleVersion) -> bool:
    """Была ли редакция опубликована ДО этой записи.

    Спрашивается база, а не объект: сама публикация — это запись `approved_at`
    в неопубликованную редакцию, и её запрещать нельзя, а у объекта, чьи поля
    истекли после коммита, прежнего значения в памяти нет вовсе — проверка по
    памяти пропустила бы правку молча.
    """

    table = KbArticleVersion.__table__
    stored = connection.scalar(select(table.c.approved_at).where(table.c.id == target.id))
    return stored is not None


@event.listens_for(KbArticleVersion, "before_update", propagate=True)
def _forbid_published_update(
    _mapper: object, connection: Connection, target: KbArticleVersion
) -> None:
    if _was_published(connection, target):
        raise PublishedVersionImmutableError(
            "kb_article_versions: опубликованная редакция не меняется — правка "
            "оформляется новой редакцией (ADR-0093)."
        )


@event.listens_for(KbArticleVersion, "before_delete", propagate=True)
def _forbid_published_delete(
    _mapper: object, connection: Connection, target: KbArticleVersion
) -> None:
    if _was_published(connection, target):
        raise PublishedVersionImmutableError(
            "kb_article_versions: опубликованная редакция не удаляется (ADR-0093)."
        )


class KbChunk(Base, UUIDPkMixin):
    __tablename__ = "kb_chunks"
    __table_args__ = (
        # Порядок куска внутри статьи уникален: пересборка статьи заменяет
        # куски, а не добавляет вторые с тем же номером.
        UniqueConstraint("doc_slug", "ord", name="uq_kb_chunks_doc_ord"),
        Index("ix_kb_chunks_search", "search_tsv", postgresql_using="gin"),
    )

    #: Статья и её живая редакция, из которой собран кусок. Кусок без статьи
    #: невозможен: индекс производен от опубликованного текста и только от него.
    article_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("kb_articles.id", ondelete="CASCADE", name="fk_kb_chunks_article"),
        nullable=False,
        index=True,
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("kb_article_versions.id", ondelete="CASCADE", name="fk_kb_chunks_version"),
        nullable=False,
    )

    #: Имя статьи (`kb_articles.slug`) — то, чем помощник ссылается на
    #: источник в ответе.
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
    #: Откуда текст: путь файла у встроенной редакции, `kb:<slug>/v<номер>` у
    #: заведённой в кабинете. Вместе с `source_sha256` (хеш тела редакции)
    #: говорит, по какой редакции собран кусок.
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
