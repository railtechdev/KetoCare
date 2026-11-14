"""A recipe file becomes numbered lines, whatever it was (ADR-0079)."""

from __future__ import annotations

import io
import zipfile

import pytest

from api.services import recipe_file

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _paragraph(text: str, style: str | None = None) -> str:
    props = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{props}<w:r><w:t>{text}</w:t></w:r></w:p>"


def _docx(body: str, *, media: bool = False) -> bytes:
    """A Word document with the two parts the reader looks at.

    The heading style id is "21", as a Russian Word names it: only the style's
    name says it is a heading, and the dietitian's own file is like this.
    """

    document = f'<w:document xmlns:w="{_W}"><w:body>{body}</w:body></w:document>'
    styles = (
        f'<w:styles xmlns:w="{_W}">'
        '<w:style w:type="paragraph" w:styleId="21"><w:name w:val="heading 2"/></w:style>'
        '<w:style w:type="paragraph" w:styleId="a"><w:name w:val="List Bullet"/></w:style>'
        "</w:styles>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", styles)
        if media:
            archive.writestr("word/media/image1.jpeg", b"\xff\xd8\xff")
    return buffer.getvalue()


class TestWord:
    def test_headings_and_list_items_in_reading_order(self):
        content = _docx(
            _paragraph("Кето-блинчики", "21")
            + _paragraph("Ингредиенты:")
            + _paragraph("Яйцо — 28 г", "a")
        )

        assert recipe_file.extract_lines(content) == [
            "# Кето-блинчики",
            "Ингредиенты:",
            "Яйцо — 28 г",
        ]

    def test_a_table_row_is_one_line(self):
        row = (
            "<w:tr><w:tc>" + _paragraph("Масло") + "</w:tc><w:tc>" + _paragraph("30") + "</w:tc>"
            "</w:tr>"
        )

        assert recipe_file.extract_lines(_docx(f"<w:tbl>{row}</w:tbl>")) == ["Масло | 30"]

    def test_a_scan_inside_a_document_is_named_as_such(self):
        """Two of the clinic's own files are photographs pasted into Word."""

        with pytest.raises(recipe_file.UnreadableFile, match="скан"):
            recipe_file.extract_lines(_docx(_paragraph(""), media=True))

    def test_a_document_with_a_dtd_is_refused(self):
        """Word never writes one; a file that has it is built to expand entities."""

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(
                "word/document.xml",
                '<!DOCTYPE x [<!ENTITY a "aaaa">]>'
                f'<w:document xmlns:w="{_W}"><w:body/></w:document>',
            )

        with pytest.raises(recipe_file.UnreadableFile, match="повреждён"):
            recipe_file.extract_lines(buffer.getvalue())


class TestText:
    def test_blank_runs_collapse_to_one_separator(self):
        text = "Омлет\n\n\n\nЯйцо 55 г\n\n"

        assert recipe_file.lines_of_text(text) == ["Омлет", "", "Яйцо 55 г"]

    def test_a_windows_text_file_is_read(self):
        content = "Масло сливочное — 30 г".encode("cp1251")

        assert recipe_file.extract_lines(content) == ["Масло сливочное — 30 г"]

    def test_empty_text_is_refused(self):
        with pytest.raises(recipe_file.UnreadableFile):
            recipe_file.lines_of_text("  \n \n")

    def test_too_much_for_one_upload(self):
        with pytest.raises(recipe_file.UnreadableFile, match="частями"):
            recipe_file.lines_of_text("строка\n" * (recipe_file.MAX_LINES + 1))


class TestRefusalsNameAWayOut:
    """«Unsupported file» alone is the dead end this feature exists to remove."""

    @pytest.mark.parametrize(
        ("content", "advice"),
        [
            (b"%PDF-1.7 ...", "Вставить текст"),
            (b"\xd0\xcf\x11\xe0 old word", ".docx"),
            (b"\xff\xd8\xff photo", "Вставить текст"),
        ],
    )
    def test_refusal_says_what_to_do(self, content, advice):
        with pytest.raises(recipe_file.UnreadableFile, match=advice):
            recipe_file.extract_lines(content)

    def test_an_archive_that_is_not_a_document(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("readme.txt", "hello")

        with pytest.raises(recipe_file.UnreadableFile, match="Word"):
            recipe_file.extract_lines(buffer.getvalue())
