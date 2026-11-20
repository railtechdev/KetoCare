"""База знаний помощника: разбор файлов, статьи кабинета и индекс (раздел 10.4 ТЗ, ADR-0093)."""

from .documents import (
    Article,
    ArticleError,
    Chunk,
    article_paths,
    read_article,
    split_article,
    split_text,
)

__all__ = [
    "Article",
    "ArticleError",
    "Chunk",
    "article_paths",
    "read_article",
    "split_article",
    "split_text",
]
