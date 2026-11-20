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

#: Каталоги, из которых индекс берёт статьи. Только эти два и только они:
#: рядом лежат материалы, которые до семьи доезжать не должны вовсе, —
#: например, `clinical-drafts/`, черновики клинических статей из открытых
#: источников, ждущие подписи медицинской команды. Обход всего дерева
#: подхватил бы их, и единственной преградой остался бы `status: draft` в
#: заголовке, который правится одной строкой.
INDEXED_DIRS = ("product", "clinical")

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
    #: Подпись клинической статьи из заголовка файла. С ADR-0093 клиническая
    #: статья переносится из файла в кабинет один раз, и подпись становится
    #: первой опубликованной редакцией.
    approved_by: str | None = None
    approved_at: str | None = None


@dataclass(frozen=True, slots=True)
class Chunk:
    """Кусок статьи: то, что уходит модели и попадает в индекс."""

    ord: int
    heading_path: str
    body: str


def article_paths(root: Path) -> list[Path]:
    """Файлы статей базы знаний: `product/` и `clinical/`, без README.

    Одна функция на индекс и на проверку `--check`: две копии обхода однажды
    разошлись бы, и проверка пропускала бы то, на чём падает выкат.
    """

    paths: list[Path] = []
    for name in INDEXED_DIRS:
        directory = root / name
        if directory.is_dir():
            paths.extend(path for path in directory.rglob("*.md") if path.name != "README.md")
    return sorted(paths)


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
    folder = _indexed_folder(path, root=root)
    if folder is not None and folder != kind:
        # Каталог и вид обязаны совпадать: хук защищает от правки только
        # `clinical/`, и клиническая статья, положенная в `product/`, иначе
        # прошла бы в помощник мимо и защиты, и проверки специалистом.
        raise ArticleError(
            f"{path.name}: kind «{kind}» не совпадает с каталогом «{folder}/» — "
            f"статья вида «{kind}» лежит только в «{kind}/»"
        )
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
        approved_by=fields.get("approved_by") or None,
        approved_at=fields.get("approved_at") or None,
    )


def _indexed_folder(path: Path, *, root: Path) -> str | None:
    """Каталог индекса (`product` или `clinical`), в котором лежит файл."""

    try:
        parts = path.resolve().relative_to(root.resolve()).parts
    except ValueError:
        return None
    if len(parts) > 1 and parts[0] in INDEXED_DIRS:
        return parts[0]
    return None


def split_article(article: Article) -> list[Chunk]:
    """Разрезать статью из файла по заголовкам второго уровня — см. `split_text`."""

    return split_text(article.title, article.body)


def split_text(title: str, body: str) -> list[Chunk]:
    """Разрезать текст статьи по заголовкам второго уровня.

    Режется по разделам, а не по числу символов: раздел — это законченная
    мысль, а кусок, оборванный посреди списка, приезжает модели без половины
    условий. Каждый кусок несёт путь заголовков — без него текст теряет
    контекст, и модель отвечает про кетоны словами про вес.

    Одна функция на статьи из файлов и на статьи кабинета: и индекс, и проверка
    черновика постфильтром режут текст ровно так, как его прочтёт модель.
    """

    headings = list(_HEADING.finditer(body))
    if not headings:
        return [Chunk(ord=0, heading_path=title, body=body.strip())]

    chunks: list[Chunk] = []
    # Текст вне разделов — до первого заголовка или сразу под заголовком
    # первого уровня — тоже кусок, с заголовком статьи в пути. В файлах его нет
    # (статья начинается с H1, за ним сразу `##`), а в кабинете он обычен:
    # вступление перед первым разделом или документ Word, где разделы — это
    # «Заголовок 1». Выбрасывать его значило бы молча не показать модели часть
    # опубликованного текста.
    preamble = body[: headings[0].start()].strip()
    if preamble:
        chunks.append(Chunk(ord=0, heading_path=title, body=preamble))
    for index, heading in enumerate(headings):
        level = len(heading.group(1))
        start = heading.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(body)
        section = body[start:end].strip()
        if not section:
            continue
        name = heading.group(2)
        # H1 с текстом заголовка статьи — сам заголовок, его текст в `title`.
        path = title if level == 1 and name == title else f"{title} › {name}"
        chunks.append(Chunk(ord=len(chunks), heading_path=path, body=section))

    if not chunks:
        return [Chunk(ord=0, heading_path=title, body=body.strip())]
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
