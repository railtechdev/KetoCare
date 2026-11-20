"""A Word document becomes the markdown of a knowledge base article (ADR-0093).

The documents are built here, part by part, as Word writes them: a heading style
whose id means nothing ("21", "a0") and whose name or outline level says what
it is, lists through `numbering.xml`, bold as a run property.
"""

from __future__ import annotations

import io
import zipfile

import pytest

from api.services import article_file
from api.services.recipe_file import UnreadableFile

_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

_STYLES = (
    f'<w:styles xmlns:w="{_W}">'
    # Russian Word: the id is a number, the name says "heading 1".
    '<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style>'
    '<w:style w:type="paragraph" w:styleId="21"><w:name w:val="Заголовок 2"/></w:style>'
    # A custom style that is a heading only by its outline level (third level).
    '<w:style w:type="paragraph" w:styleId="a5"><w:name w:val="Мой раздел"/>'
    '<w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>'
    '<w:style w:type="paragraph" w:styleId="a0"><w:name w:val="Normal"/></w:style>'
    "</w:styles>"
)

_NUMBERING = (
    f'<w:numbering xmlns:w="{_W}">'
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>'
    "</w:abstractNum>"
    '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl>'
    "</w:abstractNum>"
    '<w:num w:numId="5"><w:abstractNumId w:val="0"/></w:num>'
    '<w:num w:numId="6"><w:abstractNumId w:val="1"/></w:num>'
    "</w:numbering>"
)


def _run(text: str, *, bold: bool = False) -> str:
    props = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:r>{props}<w:t xml:space="preserve">{text}</w:t></w:r>'


def _p(*runs: str, style: str | None = None, num: str | None = None) -> str:
    props = ""
    if style:
        props += f'<w:pStyle w:val="{style}"/>'
    if num:
        props += f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num}"/></w:numPr>'
    return f"<w:p><w:pPr>{props}</w:pPr>{''.join(runs)}</w:p>"


def _docx(body: str, *, media: bool = False, numbering: bool = True) -> bytes:
    document = f'<w:document xmlns:w="{_W}"><w:body>{body}</w:body></w:document>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", _STYLES)
        if numbering:
            archive.writestr("word/numbering.xml", _NUMBERING)
        if media:
            archive.writestr("word/media/image1.png", b"\x89PNG")
    return buffer.getvalue()


class TestWord:
    def test_headings_by_style_name_and_outline_level(self) -> None:
        content = _docx(
            _p(_run("Ребёнок заболел"), style="1")
            + _p(_run("Короткий ответ"), style="21")
            + _p(_run("Сообщите своей команде."))
            + _p(_run("Подробно"), style="a5")
            + _p(_run("Текст."))
        )

        converted = article_file.extract_article(content)

        assert converted.body_md == (
            "# Ребёнок заболел\n\n## Короткий ответ\n\nСообщите своей команде.\n\n"
            "### Подробно\n\nТекст."
        )
        assert converted.title == "Ребёнок заболел"

    def test_outline_level_on_the_paragraph_itself(self) -> None:
        paragraph = '<w:p><w:pPr><w:outlineLvl w:val="1"/></w:pPr>' + _run("Раздел") + "</w:p>"

        assert article_file.extract_article(_docx(paragraph)).body_md == "## Раздел"

    def test_bulleted_and_numbered_lists(self) -> None:
        content = _docx(
            _p(_run("Что взять:"))
            + _p(_run("воду"), num="5")
            + _p(_run("тест-полоски"), num="5")
            + _p(_run("Порядок:"))
            + _p(_run("измерьте"), num="6")
            + _p(_run("запишите"), num="6")
        )

        assert article_file.extract_article(content).body_md == (
            "Что взять:\n\n- воду\n- тест-полоски\n\nПорядок:\n\n1. измерьте\n1. запишите"
        )

    def test_list_without_numbering_part_is_bulleted(self) -> None:
        content = _docx(_p(_run("пункт"), num="5"), numbering=False)

        assert article_file.extract_article(content).body_md == "- пункт"

    def test_bold_runs_are_marked_and_merged(self) -> None:
        content = _docx(
            _p(_run("Звоните "), _run("сразу, ", bold=True), _run("если", bold=True), _run(" ..."))
        )

        assert article_file.extract_article(content).body_md == "Звоните **сразу, если** ..."

    def test_bold_off_is_not_bold(self) -> None:
        run = '<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>обычный</w:t></w:r>'

        assert article_file.extract_article(_docx(_p(run))).body_md == "обычный"

    def test_heading_text_is_not_wrapped_in_bold(self) -> None:
        content = _docx(_p(_run("Раздел", bold=True), style="21"))

        assert article_file.extract_article(content).body_md == "## Раздел"

    def test_table_rows_are_joined_by_bars(self) -> None:
        row = (
            "<w:tr><w:tc>"
            + _p(_run("Кетоны"))
            + "</w:tc><w:tc>"
            + _p(_run("2,5"))
            + "</w:tc></w:tr>"
        )
        content = _docx(_p(_run("Таблица:")) + f"<w:tbl>{row}{row}</w:tbl>")

        assert article_file.extract_article(content).body_md == (
            "Таблица:\n\nКетоны | 2,5\nКетоны | 2,5"
        )

    def test_empty_paragraphs_collapse(self) -> None:
        content = _docx(_p(_run("Один")) + _p() + _p(_run("   ")) + _p() + _p(_run("Два")))

        assert article_file.extract_article(content).body_md == "Один\n\nДва"

    def test_only_pictures_is_named_a_scan(self) -> None:
        with pytest.raises(UnreadableFile, match="скан"):
            article_file.extract_article(_docx(_p(), media=True))

    def test_a_dtd_is_refused(self) -> None:
        """The recipe file's guard: Word never writes one."""

        document = (
            f'<!DOCTYPE x [<!ENTITY a "aaaa">]><w:document xmlns:w="{_W}"><w:body/></w:document>'
        )
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("word/document.xml", document)

        with pytest.raises(UnreadableFile, match="повреждён"):
            article_file.extract_article(buffer.getvalue())

    def test_an_oversized_document_part_is_refused(self, monkeypatch) -> None:
        """A part that unpacks beyond the cap is not read into memory."""

        from api.services import recipe_file

        monkeypatch.setattr(recipe_file, "_MAX_DOCUMENT_BYTES", 10)

        with pytest.raises(UnreadableFile, match="слишком большой"):
            article_file.extract_article(_docx(_p(_run("Текст статьи"))))

    def test_a_damaged_document_part_is_refused(self) -> None:
        """The archive opens, its part does not (bad CRC): a 422 with a way
        out, not a 500."""

        text = "Текст статьи, которого не прочитать"
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
            archive.writestr(
                "word/document.xml",
                f'<w:document xmlns:w="{_W}"><w:body>{_p(_run(text))}</w:body></w:document>',
            )
        raw = bytearray(buffer.getvalue())
        at = raw.index("Текст".encode())
        raw[at] ^= 0x01

        with pytest.raises(UnreadableFile, match="повреждён"):
            article_file.extract_article(bytes(raw))

    def test_an_encrypted_document_part_is_refused(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(
                "word/document.xml",
                f'<w:document xmlns:w="{_W}"><w:body>{_p(_run("Текст"))}</w:body></w:document>',
            )
        raw = bytearray(buffer.getvalue())
        # The "encrypted" bit of the general purpose flags, in the local header
        # (offset 6) and in the central directory (offset 8) — `zipfile` writes
        # it as zero and refuses to read an entry that has it without a password.
        raw[raw.index(b"PK\x03\x04") + 6] |= 0x1
        raw[raw.index(b"PK\x01\x02") + 8] |= 0x1

        with pytest.raises(UnreadableFile, match="повреждён"):
            article_file.extract_article(bytes(raw))

    def test_an_archive_without_a_document_is_refused(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("xl/workbook.xml", "<x/>")

        with pytest.raises(UnreadableFile, match="docx"):
            article_file.extract_article(buffer.getvalue())


class TestOtherFormats:
    @pytest.mark.parametrize(
        ("content", "named"),
        [
            (b"%PDF-1.7 ...", "PDF"),
            (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", ".doc"),
            (b"\xff\xd8\xff\xe0 jpeg", "сканы"),
            (b"\x89PNG\r\n", "сканы"),
        ],
    )
    def test_unreadable_formats_name_a_way_out(self, content: bytes, named: str) -> None:
        with pytest.raises(UnreadableFile, match=named) as refused:
            article_file.extract_article(content)

        assert ".docx" in str(refused.value)
        assert "вставьте текст" in str(refused.value)

    def test_plain_text_file_is_kept_as_is(self) -> None:
        text = "# Заголовок\r\n\r\n## Раздел\r\n\r\n- пункт **важно**\r\n"

        converted = article_file.extract_article(text.encode("utf-8"))

        assert converted.body_md == "# Заголовок\n\n## Раздел\n\n- пункт **важно**"
        assert converted.title == "Заголовок"

    def test_cp1251_text_is_read(self) -> None:
        converted = article_file.extract_article("Кетоны в моче".encode("cp1251"))

        assert converted.body_md == "Кетоны в моче"

    def test_pasted_text_is_accepted_as_is(self) -> None:
        assert article_file.text_article("  ## Раздел\n\nТекст.  ").body_md == "## Раздел\n\nТекст."

    def test_empty_text_is_refused(self) -> None:
        with pytest.raises(UnreadableFile, match="нет текста"):
            article_file.extract_article(b"   \n ")

    def test_too_long_text_is_refused(self) -> None:
        with pytest.raises(UnreadableFile, match="слишком большой"):
            article_file.text_article("а" * (article_file.MAX_ARTICLE_CHARS + 1))
