"""A Word document as the markdown of a knowledge base article (ADR-0093).

A specialist writes the article in Word, as she writes everything else, and the
cabinet turns it into the text the assistant reads. Only the structure that
matters to the assistant survives: headings (they cut the article into the
sections the model receives), lists, bold, table rows. Anything else — fonts,
colours, pictures — is dropped, and the specialist sees the result in the form
before saving it.

The archive and XML guards are the recipe file's (`recipe_file.xml_part`): a
size cap on the unpacked part and a refusal of any DTD. Formats that cannot be
read are refused with a way out — save as .docx or paste the text.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass
from xml.etree import ElementTree

from .recipe_file import UnreadableFile, decode_text, xml_part

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

#: An article is a few pages; a hundred thousand characters is a small book.
MAX_ARTICLE_CHARS = 100_000

_HEADING_NAMES = ("heading", "title", "заголовок")

_FALSE = ("0", "false", "off", "none")

_WAY_OUT = "Сохраните документ как .docx или вставьте текст статьи в поле."


@dataclass(frozen=True, slots=True)
class ArticleText:
    #: The first top-level heading, offered as the article title.
    title: str | None
    body_md: str


def extract_article(content: bytes) -> ArticleText:
    """Markdown of an uploaded file: .docx is converted, plain text kept as is."""

    if content.startswith(b"PK"):
        body = _docx_markdown(content)
    elif content.startswith(b"%PDF"):
        raise UnreadableFile(f"PDF не читается. {_WAY_OUT}")
    elif content.startswith(b"\xd0\xcf\x11\xe0"):
        raise UnreadableFile(f"Это файл старого формата (.doc). {_WAY_OUT}")
    elif content.startswith((b"\xff\xd8\xff", b"\x89PNG", b"GIF8")):
        raise UnreadableFile(f"Фотографии и сканы не читаются. {_WAY_OUT}")
    else:
        body = _plain(decode_text(content))
    return _checked(body)


def text_article(text: str) -> ArticleText:
    """Pasted text is accepted as is: it is already what the author wants."""

    return _checked(_plain(text))


def _plain(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").strip()


_H1 = re.compile(r"^#[ \t]+(.+?)[ \t]*$", re.MULTILINE)


def _checked(body: str) -> ArticleText:
    if not body.strip():
        raise UnreadableFile("В файле нет текста.")
    if len(body) > MAX_ARTICLE_CHARS:
        raise UnreadableFile(
            "Текст слишком большой для одной статьи. Разделите его на несколько статей."
        )
    heading = _H1.search(body)
    return ArticleText(title=heading.group(1)[:255] if heading else None, body_md=body)


def _docx_markdown(content: bytes) -> str:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as error:
        raise UnreadableFile("Файл повреждён: его не удалось открыть.") from error

    with archive:
        names = set(archive.namelist())
        if "word/document.xml" not in names:
            raise UnreadableFile(f"Этот формат не читается. {_WAY_OUT}")
        body = xml_part(archive, "word/document.xml").find(f"{_W}body")
        heading_levels = _style_heading_levels(archive, names)
        list_formats = _list_formats(archive, names)
        has_media = any(name.startswith("word/media/") for name in names)

    blocks: list[tuple[str, str]] = []
    if body is not None:
        for element in body:
            if element.tag == f"{_W}p":
                block = _paragraph(element, heading_levels, list_formats)
                if block is not None:
                    blocks.append(block)
            elif element.tag == f"{_W}tbl":
                blocks.extend(("row", row) for row in _table_rows(element) if row)

    if not blocks and has_media:
        raise UnreadableFile(
            "В документе только изображения — похоже, это скан. Сканы не читаются: "
            "наберите или вставьте текст статьи в поле."
        )
    return _join(blocks)


def _join(blocks: list[tuple[str, str]]) -> str:
    """Blocks to markdown: list items and table rows stay on adjacent lines,
    everything else is separated by one blank line."""

    out: list[str] = []
    previous = ""
    for kind, text in blocks:
        if out:
            together = kind == previous and kind in ("li", "row")
            out.append("\n" if together else "\n\n")
        out.append(text)
        previous = kind
    return "".join(out).strip()


def _level_of(name: str, outline: str | None) -> int | None:
    if outline is not None and outline.isdigit() and int(outline) < 9:
        return int(outline) + 1
    label = name.lower()
    if not label.startswith(_HEADING_NAMES):
        return None
    digits = [char for char in label if char.isdigit()]
    return int(digits[0]) if digits else 1


def _style_heading_levels(archive: zipfile.ZipFile, names: set[str]) -> dict[str, int]:
    """Heading level of each heading style, by style id.

    The id is whatever the author's Word made up ("21", "a0"); the level comes
    from the style's outline level or from the digit in its name ("heading 2",
    "Заголовок 2").
    """

    if "word/styles.xml" not in names:
        return {}
    levels: dict[str, int] = {}
    for style in xml_part(archive, "word/styles.xml").iter(f"{_W}style"):
        style_id = style.get(f"{_W}styleId")
        name = style.find(f"{_W}name")
        outline = style.find(f"{_W}pPr/{_W}outlineLvl")
        level = _level_of(
            (name.get(f"{_W}val") if name is not None else "") or "",
            outline.get(f"{_W}val") if outline is not None else None,
        )
        if style_id and level is not None:
            levels[style_id] = level
    return levels


def _list_formats(archive: zipfile.ZipFile, names: set[str]) -> dict[tuple[str, str], str]:
    """`(numId, ilvl)` → number format ("bullet", "decimal", …)."""

    if "word/numbering.xml" not in names:
        return {}
    root = xml_part(archive, "word/numbering.xml")
    abstract: dict[str, dict[str, str]] = {}
    for definition in root.iter(f"{_W}abstractNum"):
        formats: dict[str, str] = {}
        for level in definition.findall(f"{_W}lvl"):
            fmt = level.find(f"{_W}numFmt")
            formats[level.get(f"{_W}ilvl") or "0"] = (
                fmt.get(f"{_W}val") if fmt is not None else None
            ) or "bullet"
        abstract[definition.get(f"{_W}abstractNumId") or ""] = formats

    result: dict[tuple[str, str], str] = {}
    for num in root.iter(f"{_W}num"):
        ref = num.find(f"{_W}abstractNumId")
        levels = abstract.get((ref.get(f"{_W}val") if ref is not None else "") or "", {})
        for ilvl, number_format in levels.items():
            result[(num.get(f"{_W}numId") or "", ilvl)] = number_format
    return result


def _paragraph(
    paragraph: ElementTree.Element,
    heading_levels: dict[str, int],
    list_formats: dict[tuple[str, str], str],
) -> tuple[str, str] | None:
    style = paragraph.find(f"{_W}pPr/{_W}pStyle")
    outline = paragraph.find(f"{_W}pPr/{_W}outlineLvl")
    level = None
    if outline is not None:
        level = _level_of("", outline.get(f"{_W}val"))
    if level is None and style is not None:
        level = heading_levels.get(style.get(f"{_W}val") or "")

    text = _runs(paragraph, bold=level is None)
    if not text.strip():
        return None

    if level is not None:
        plain = " ".join(text.split())
        return "h", f"{'#' * min(level, 3)} {plain}"

    numbering = paragraph.find(f"{_W}pPr/{_W}numPr")
    if numbering is not None:
        num_id = numbering.find(f"{_W}numId")
        ilvl = numbering.find(f"{_W}ilvl")
        num = (num_id.get(f"{_W}val") if num_id is not None else None) or "0"
        depth = (ilvl.get(f"{_W}val") if ilvl is not None else None) or "0"
        if num != "0":
            fmt = list_formats.get((num, depth), "bullet")
            marker = "- " if fmt in ("bullet", "none") else "1. "
            indent = "   " * int(depth) if depth.isdigit() else ""
            return "li", f"{indent}{marker}{' '.join(text.split())}"
    return "p", text.strip()


def _runs(paragraph: ElementTree.Element, *, bold: bool) -> str:
    """Text of a paragraph with bold runs marked `**…**`."""

    segments: list[tuple[str, bool]] = []
    for run in paragraph.iter(f"{_W}r"):
        weight = run.find(f"{_W}rPr/{_W}b")
        is_bold = (
            bold and weight is not None and (weight.get(f"{_W}val") or "true").lower() not in _FALSE
        )
        text = ""
        for node in run:
            if node.tag == f"{_W}t":
                text += node.text or ""
            elif node.tag == f"{_W}tab":
                text += " "
            elif node.tag in (f"{_W}br", f"{_W}cr"):
                text += "\n"
        if not text:
            continue
        if segments and segments[-1][1] == is_bold:
            segments[-1] = (segments[-1][0] + text, is_bold)
        else:
            segments.append((text, is_bold))

    out: list[str] = []
    for text, is_bold in segments:
        core = text.strip()
        if is_bold and core:
            lead = text[: len(text) - len(text.lstrip())]
            trail = text[len(text.rstrip()) :]
            out.append(f"{lead}**{core}**{trail}")
        else:
            out.append(text)
    return "".join(out)


def _table_rows(table: ElementTree.Element) -> list[str]:
    """Direct rows and cells only: a table nested in a cell would otherwise be
    read twice — once with the cell, once as rows of its own."""

    rows: list[str] = []
    for row in table.findall(f"{_W}tr"):
        cells = [
            " ".join(" ".join(_runs(p, bold=False).split()) for p in cell.iter(f"{_W}p")).strip()
            for cell in row.findall(f"{_W}tc")
        ]
        rows.append(" | ".join(cell for cell in cells if cell))
    return rows
