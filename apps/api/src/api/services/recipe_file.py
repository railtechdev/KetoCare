"""Text of a recipe file, line by line (ADR-0079).

The dietitian uploads what she has — a Word document, a spreadsheet, a text
file — and the first step is the same for all of them: turn the file into
numbered lines. The model then points at lines instead of retyping them, and
the reviewer sees the original line next to what was read from it.

Nothing here understands recipes. A heading stays a line marked with `# `, a
table row stays a line with cells joined by ` | `: enough for the model to see
the structure the author gave the file, and no more.

A format that cannot be read is refused **by name and with a way out** (save as
.docx, paste the text): "unsupported file" alone is the dead end this feature
exists to remove.
"""

from __future__ import annotations

import csv
import io
import zipfile
from xml.etree import ElementTree

from . import spreadsheet

#: Limits of one upload. A collection larger than this is split by the author:
#: the review table for three thousand lines is already several sittings.
MAX_LINES = 3000
MAX_CHARS = 250_000
MAX_LINE_CHARS = 600

#: `word/document.xml` unpacked. A recipe book is far below this; a larger part
#: is either not a recipe book or an archive built to exhaust memory.
_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

_HEADING_STYLES = ("heading", "title", "заголовок")


class UnreadableFile(Exception):
    """The file cannot be turned into text; the message is for the reviewer."""


def extract_lines(content: bytes) -> list[str]:
    """Lines of the file, in reading order, within the upload limits."""

    lines = _normalised(_raw_lines(content))
    if not lines:
        raise UnreadableFile("В файле нет текста.")
    if len(lines) > MAX_LINES or sum(len(line) for line in lines) > MAX_CHARS:
        raise UnreadableFile(
            f"Файл слишком большой для одной загрузки (больше {MAX_LINES} строк). "
            "Разделите его на части и загрузите по очереди."
        )
    return lines


def lines_of_text(text: str) -> list[str]:
    """The same for text pasted into the form."""

    lines = _normalised(text.splitlines())
    if not lines:
        raise UnreadableFile("Текст пуст.")
    if len(lines) > MAX_LINES or sum(len(line) for line in lines) > MAX_CHARS:
        raise UnreadableFile(
            f"Текст слишком большой для одной загрузки (больше {MAX_LINES} строк). "
            "Вставьте его частями."
        )
    return lines


def _raw_lines(content: bytes) -> list[str]:
    if content.startswith(b"PK"):
        return _office_lines(content)
    if content.startswith(b"%PDF"):
        raise UnreadableFile(
            "PDF пока не читается. Откройте файл, выделите текст и вставьте его "
            "в поле «Вставить текст» — или сохраните документ как .docx."
        )
    if content.startswith(b"\xd0\xcf\x11\xe0"):
        raise UnreadableFile(
            "Это файл старого формата (.doc или .xls). Откройте его и сохраните "
            "как .docx или .xlsx — либо вставьте текст в поле «Вставить текст»."
        )
    if content.startswith((b"\xff\xd8\xff", b"\x89PNG", b"GIF8")):
        raise UnreadableFile(
            "Фотографии и сканы пока не читаются. Наберите или вставьте текст "
            "рецептов в поле «Вставить текст»."
        )
    return _decode(content).splitlines()


def _office_lines(content: bytes) -> list[str]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as error:
        raise UnreadableFile("Файл повреждён: его не удалось открыть.") from error

    with archive:
        names = set(archive.namelist())
        if "word/document.xml" in names:
            return _docx_lines(archive)
        if "xl/workbook.xml" in names:
            return _xlsx_lines(content)
    raise UnreadableFile(
        "Этот формат не читается. Подойдут Word (.docx), Excel (.xlsx) и обычный "
        "текст; текст можно и вставить в поле «Вставить текст»."
    )


def _xlsx_lines(content: bytes) -> list[str]:
    try:
        table = spreadsheet.xlsx_to_csv(content)
    except spreadsheet.SpreadsheetError as error:
        raise UnreadableFile(str(error)) from error
    rows = csv.reader(io.StringIO(table.decode("utf-8-sig")))
    return [" | ".join(cell.strip() for cell in row if cell.strip()) for row in rows]


def _xml_part(archive: zipfile.ZipFile, name: str) -> ElementTree.Element:
    info = archive.getinfo(name)
    if info.file_size > _MAX_DOCUMENT_BYTES:
        raise UnreadableFile("Документ слишком большой. Разделите его на части.")
    raw = archive.read(info)
    # A Word document never carries a DTD. One that does is not a document but
    # an attempt to make the parser expand entities.
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
        raise UnreadableFile("Файл повреждён: его не удалось прочитать.")
    try:
        return ElementTree.fromstring(raw)
    except ElementTree.ParseError as error:
        raise UnreadableFile("Файл повреждён: его не удалось прочитать.") from error


def _heading_style_ids(archive: zipfile.ZipFile) -> set[str]:
    """Ids of the heading styles.

    A paragraph refers to its style by id, and the id is whatever the author's
    Word made up ("21", "a0"); only the style's name says it is a heading.
    """

    if "word/styles.xml" not in archive.namelist():
        return set()
    found: set[str] = set()
    for style in _xml_part(archive, "word/styles.xml").iter(f"{_W}style"):
        name = style.find(f"{_W}name")
        label = ((name.get(f"{_W}val") if name is not None else "") or "").lower()
        style_id = style.get(f"{_W}styleId")
        if style_id and label.startswith(_HEADING_STYLES):
            found.add(style_id)
    return found


def _docx_lines(archive: zipfile.ZipFile) -> list[str]:
    body = _xml_part(archive, "word/document.xml").find(f"{_W}body")
    if body is None:
        return []
    headings = _heading_style_ids(archive)

    lines: list[str] = []
    for block in body:
        if block.tag == f"{_W}p":
            lines.extend(_paragraph_lines(block, headings))
        elif block.tag == f"{_W}tbl":
            for row in block.iter(f"{_W}tr"):
                cells = [
                    " ".join(
                        text
                        for paragraph in cell.iter(f"{_W}p")
                        for text in _paragraph_lines(paragraph, set())
                    )
                    for cell in row.iter(f"{_W}tc")
                ]
                lines.append(" | ".join(cell for cell in cells if cell.strip()))

    if not any(line.strip() for line in lines) and any(
        name.startswith("word/media/") for name in archive.namelist()
    ):
        raise UnreadableFile(
            "В документе только изображения — похоже, это скан. Сканы пока не "
            "читаются: наберите или вставьте текст рецептов в поле «Вставить текст»."
        )
    return lines


def _paragraph_lines(paragraph: ElementTree.Element, headings: set[str]) -> list[str]:
    """Text of a paragraph; a manual line break inside it starts a new line."""

    parts: list[str] = [""]
    for node in paragraph.iter():
        if node.tag == f"{_W}t":
            parts[-1] += node.text or ""
        elif node.tag == f"{_W}tab":
            parts[-1] += " "
        elif node.tag in (f"{_W}br", f"{_W}cr"):
            parts.append("")

    lines = [part.strip() for part in parts]
    style = paragraph.find(f"{_W}pPr/{_W}pStyle")
    if lines[0] and style is not None and style.get(f"{_W}val") in headings:
        lines[0] = f"# {lines[0]}"
    return lines


def _decode(content: bytes) -> str:
    """Text files come from Windows as often as not: UTF-8 first, then the rest."""

    if content.startswith((b"\xff\xfe", b"\xfe\xff")):
        return content.decode("utf-16", errors="replace")
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    if b"\x00" in content:
        raise UnreadableFile(
            "Этот формат не читается. Подойдут Word (.docx), Excel (.xlsx) и обычный "
            "текст; текст можно и вставить в поле «Вставить текст»."
        )
    return content.decode("cp1251", errors="replace")


def _normalised(lines: list[str]) -> list[str]:
    """Trimmed lines with runs of blank ones collapsed to a single separator.

    One blank line is kept: it is often the only thing that separates two
    recipes in a plain-text file.
    """

    result: list[str] = []
    for line in lines:
        text = " ".join(line.replace("\x00", "").split())[:MAX_LINE_CHARS]
        if not text and (not result or not result[-1]):
            continue
        result.append(text)
    while result and not result[-1]:
        result.pop()
    return result
