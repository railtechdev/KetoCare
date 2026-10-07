"""База знаний помощника: разбор файлов и индексация (раздел 10.4 ТЗ)."""

from .documents import Article, ArticleError, Chunk, article_paths, read_article, split_article

__all__ = [
    "Article",
    "ArticleError",
    "Chunk",
    "article_paths",
    "read_article",
    "split_article",
]
