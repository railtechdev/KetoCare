"""Разбор статьи базы знаний: заголовок, поля, куски (раздел 10.4 ТЗ).

Статья — markdown с YAML-заголовком. Полнота заголовка проверяется здесь и
только здесь: `source` и подпись — не украшение, а способ проследить, откуда
взялось каждое слово, которое помощник скажет семье (правило 1 CLAUDE.md).
Ошибка разбора — отказ, а не пропуск: статья без источника не должна попасть в
индекс тихо.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

#: Поля, без которых статья не принимается ни в каком виде.
REQUIRED_FIELDS = ("id", "title", "kind", "status", "version", "source")

#: Дополнительно для клинических статей: их подписывает медицинская команда.
CLINICAL_FIELDS = ("approved_by", "approved_at")

KINDS = ("product", "clinical")
STATUSES = ("approved", "draft")

_FRONT_MATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
_HEADING = re.compile(r"^(#{1,3})\s+(.+?)\s*$", re.MULTILINE)


class ArticleError(ValueError):
    """Статья не годится: сломан заголовок или не хватает поля."""


@dataclass(frozen=True, slots=True)
class Article:
    slug: str
    title: str
    kind: str
    status: str
    version: int
    source: str
    body: str
    path: str
    sha256: str


@dataclass(frozen=True, slots=True)
class Chunk:
    """Кусок статьи: то, что уходит модели и попадает в индекс."""

    ord: int
    heading_path: str
    body: str


def read_article(path: Path, *, root: Path) -> Article:
    """Прочитать статью и проверить её заголовок.

    `root` нужен ради относительного пути: в индексе хранится
    `docs/knowledge-base/product/…`, а не путь на машине, где шла индексация.
    """

    raw = path.read_text(encoding="utf-8")
    match = _FRONT_MATTER.match(raw)
    if match is None:
        raise ArticleError(f"{path.name}: нет YAML-заголовка в начале файла")

    fields = _parse_front_matter(match.group(1), name=path.name)
    body = raw[match.end() :].strip()
    if not body:
        raise ArticleError(f"{path.name}: пустое тело статьи")

    missing = [field for field in REQUIRED_FIELDS if field not in fields]
    if missing:
        raise ArticleError(f"{path.name}: не хватает полей: {', '.join(missing)}")

    slug = fields["id"]
    if slug != path.stem:
        raise ArticleError(f"{path.name}: id «{slug}» не совпадает с именем файла")

    kind = fields["kind"]
    if kind not in KINDS:
        raise ArticleError(f"{path.name}: kind должен быть одним из {KINDS}")
    if fields["status"] not in STATUSES:
        raise ArticleError(f"{path.name}: status должен быть одним из {STATUSES}")

    if kind == "clinical":
        unsigned = [field for field in CLINICAL_FIELDS if not fields.get(field)]
        if unsigned:
            raise ArticleError(
                f"{path.name}: клиническую статью подписывает медицинская команда, "
                f"не хватает: {', '.join(unsigned)}"
            )

    try:
        version = int(fields["version"])
    except ValueError as error:
        raise ArticleError(f"{path.name}: version — целое число") from error

    return Article(
        slug=slug,
        title=fields["title"],
        kind=kind,
        status=fields["status"],
        version=version,
        source=fields["source"],
        body=body,
        path=str(path.relative_to(root.parent if root.name else root)),
        sha256=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
    )


def split_article(article: Article) -> list[Chunk]:
    """Разрезать статью по заголовкам второго уровня.

    Режется по разделам, а не по числу символов: раздел — это законченная
    мысль, а кусок, оборванный посреди списка, приезжает модели без половины
    условий. Каждый кусок несёт путь заголовков — без него текст теряет
    контекст, и модель отвечает про кетоны словами про вес.
    """

    headings = list(_HEADING.finditer(article.body))
    if not headings:
        return [Chunk(ord=0, heading_path=article.title, body=article.body.strip())]

    chunks: list[Chunk] = []
    for index, heading in enumerate(headings):
        level = len(heading.group(1))
        if level == 1:
            # H1 — заголовок статьи, он уже есть в `title`.
            continue
        start = heading.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(article.body)
        body = article.body[start:end].strip()
        if not body:
            continue
        chunks.append(
            Chunk(
                ord=len(chunks),
                heading_path=f"{article.title} › {heading.group(2)}",
                body=body,
            )
        )

    if not chunks:
        return [Chunk(ord=0, heading_path=article.title, body=article.body.strip())]
    return chunks


def _parse_front_matter(raw: str, *, name: str) -> dict[str, str]:
    """Разбор `ключ: значение` без внешнего YAML.

    Формат заголовка описан в `docs/knowledge-base/README.md` и намеренно
    беден: плоские пары строк. Тащить ради него зависимость незачем, а
    поддержка вложенности приглашала бы усложнять сам формат.
    """

    fields: dict[str, str] = {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, sep, value = stripped.partition(":")
        if not sep:
            raise ArticleError(f"{name}: строка заголовка без двоеточия: {stripped!r}")
        fields[key.strip()] = value.split("#", 1)[0].strip()
    return fields
