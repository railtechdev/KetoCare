"""Статьи выпуска и индекс помощника: `python -m core.tools.index_knowledge_base`.

Запускается при выкате, сразу после миграций, и вручную (`make kb-index`).
Отдельная команда, а не шаг приложения: она сверяет базу с файлами выпуска, и
запускать её при каждом старте воркера значит делать это на каждом перезапуске.

Что делает (ADR-0093, подробно — `core.knowledge.indexer`): встроенные
продуктовые статьи из `product/` приводит к выпуску, клинические из `clinical/`
переносит в кабинет один раз — первым прогоном, — и собирает индекс из
опубликованного. Статей, заведённых в кабинете, не касается. Повторный запуск
ничего не меняет.

Что прогон пропустил, не останавливая выката, — встроенный файл с именем,
занятым статьёй кабинета, или клинический файл после переноса, — печатается
строкой «внимание:». Это работа для разработчика, а не повод не выкатывать
остальное.

`--check` ничего не пишет и возвращает ненулевой код, если в файлах есть
ошибки. Годится для CI: статья без источника или с чужим `id` не должна
доезжать до стенда.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from ..config import get_settings
from ..db import get_sessionmaker
from ..knowledge.documents import ArticleError, article_paths, read_article
from ..knowledge.indexer import reindex


def _default_root() -> Path:
    return Path(get_settings().knowledge_base_dir)


async def _reindex(root: Path) -> int:
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        report = await reindex(session, root=root)
        if not report.ok:
            # Ошибки статей не коммитим: индекс остаётся прежним, а человек
            # видит, что чинить. Половинчатый индекс хуже старого.
            for error in report.errors:
                print(f"ошибка: {error}", file=sys.stderr)
            return 1
        await session.commit()

    for note in report.notes:
        print(f"внимание: {note}", file=sys.stderr)
    print(
        f"база знаний: {report.live_articles} статей в помощнике; "
        f"файлов выпуска {report.documents}, черновиков пропущено {report.skipped_drafts}; "
        f"встроенных добавлено {report.builtin_added}, обновлено {report.builtin_updated}, "
        f"снято {report.builtin_withdrawn}; клинических перенесено {report.clinical_imported}; "
        f"кусков записано {report.chunks}, убрано {report.removed}"
    )
    return 0


def _check(root: Path) -> int:
    problems: list[str] = []
    seen: dict[str, Path] = {}
    for path in article_paths(root):
        try:
            article = read_article(path, root=root)
        except ArticleError as error:
            problems.append(str(error))
            continue
        if article.slug in seen:
            problems.append(f"{path.name}: id «{article.slug}» уже занят {seen[article.slug].name}")
        seen[article.slug] = path

    for problem in problems:
        print(f"ошибка: {problem}", file=sys.stderr)
    if problems:
        return 1

    print(f"база знаний: {len(seen)} статей, ошибок нет")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Индекс базы знаний помощника")
    parser.add_argument("--check", action="store_true", help="только проверить файлы")
    parser.add_argument("--path", type=Path, default=None, help="каталог базы знаний")
    args = parser.parse_args()

    root = args.path or _default_root()
    if not root.exists():
        print(f"нет каталога {root}", file=sys.stderr)
        return 1

    if args.check:
        return _check(root)
    return asyncio.run(_reindex(root))


if __name__ == "__main__":
    raise SystemExit(main())
