"""База знаний помощника: разбор статей, индекс и поиск (раздел 10.4 ТЗ).

Проверяется то, что защищает семью от выдуманного ответа: статья без источника
и подписи в индекс не попадает, черновик не попадает тоже, а поиск, ничего не
нашедший, возвращает пустоту — на ней помощник не вызывает модель вовсе.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from core.knowledge.documents import ArticleError, article_paths, read_article, split_article
from core.knowledge.indexer import reindex
from core.repositories import knowledge_base as kb

PRODUCT = """---
id: how-to-record-ketones
title: Как записать кетоны
kind: product
status: approved
version: 1
source: docs/TZ_AI_AGENTS.md#7.3
---

# Как записать кетоны

## Короткий ответ

Кнопка «Кетоны» в чате с ботом или раздел «Дневник» в кабинете.

## Подробно

Значение принимается и с запятой, и с точкой.
"""


def write(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


class TestArticleFormat:
    def test_article_is_split_by_sections(self, tmp_path: Path) -> None:
        article = read_article(
            write(tmp_path / "product", "how-to-record-ketones.md", PRODUCT), root=tmp_path
        )
        chunks = split_article(article)

        assert [chunk.ord for chunk in chunks] == [0, 1]
        # Путь заголовков едет с каждым куском: без него текст теряет контекст,
        # и модель отвечает про кетоны словами про вес.
        assert chunks[0].heading_path == "Как записать кетоны › Короткий ответ"

    def test_missing_source_is_refused(self, tmp_path: Path) -> None:
        """Источник — способ проследить, откуда взялось каждое слово, которое
        помощник скажет семье (правило 1)."""

        broken = PRODUCT.replace("source: docs/TZ_AI_AGENTS.md#7.3\n", "")
        path = write(tmp_path / "product", "how-to-record-ketones.md", broken)

        with pytest.raises(ArticleError, match="source"):
            read_article(path, root=tmp_path)

    def test_clinical_article_needs_a_signature(self, tmp_path: Path) -> None:
        """Клиническую статью подписывает медицинская команда — иначе это наш
        текст о болезни ребёнка, а его писать запрещено."""

        clinical = PRODUCT.replace("kind: product", "kind: clinical")
        path = write(tmp_path / "clinical", "how-to-record-ketones.md", clinical)

        with pytest.raises(ArticleError, match="approved_by"):
            read_article(path, root=tmp_path)

    def test_id_must_match_the_file_name(self, tmp_path: Path) -> None:
        """Иначе ссылка в ответе помощника ведёт не туда, куда он думает."""

        path = write(tmp_path / "product", "other-name.md", PRODUCT)

        with pytest.raises(ArticleError, match="не совпадает"):
            read_article(path, root=tmp_path)


class TestIndex:
    @pytest.mark.asyncio
    async def test_only_approved_articles_reach_the_index(self, session, tmp_path: Path) -> None:
        """Черновик отсеивается здесь, а не в промпте: неутверждённый текст не
        должен физически доезжать до модели."""

        write(tmp_path / "product", "how-to-record-ketones.md", PRODUCT)
        write(
            tmp_path / "product",
            "draft-article.md",
            PRODUCT.replace("status: approved", "status: draft").replace(
                "id: how-to-record-ketones", "id: draft-article"
            ),
        )

        report = await reindex(session, root=tmp_path)

        assert report.documents == 1
        assert report.skipped_drafts == 1
        assert report.ok

    @pytest.mark.asyncio
    async def test_removed_article_leaves_the_index(self, session, tmp_path: Path) -> None:
        """Отозванную статью помощник цитировать не должен."""

        write(tmp_path / "product", "how-to-record-ketones.md", PRODUCT)
        await reindex(session, root=tmp_path)
        (tmp_path / "product" / "how-to-record-ketones.md").unlink()

        report = await reindex(session, root=tmp_path)

        assert report.removed > 0
        assert await kb.count_chunks(session) == 0

    @pytest.mark.asyncio
    async def test_broken_article_does_not_pass_silently(self, session, tmp_path: Path) -> None:
        write(tmp_path / "product", "how-to-record-ketones.md", PRODUCT)
        write(tmp_path / "product", "broken.md", "нет заголовка вовсе")

        report = await reindex(session, root=tmp_path)

        assert not report.ok
        assert any("broken.md" in error for error in report.errors)


class TestIndexedDirectories:
    """Индекс читает только `product/` и `clinical/`.

    Рядом лежит `clinical-drafts/` — черновики клинических статей из открытых
    источников, ждущие подписи медицинской команды. До семьи они доезжать не
    должны ни в каком виде, и преградой не может быть одна строка `status`.
    """

    @pytest.mark.asyncio
    async def test_clinical_drafts_are_not_read(self, session, tmp_path: Path) -> None:
        write(tmp_path / "product", "how-to-record-ketones.md", PRODUCT)
        # Подписанный по форме текст в каталоге черновиков: если индекс его
        # прочтёт, статус approved пропустит его к модели.
        signed = (
            PRODUCT.replace("kind: product", "kind: clinical")
            .replace("id: how-to-record-ketones", "id: ketone-strips")
            .replace("source: docs/TZ_AI_AGENTS.md#7.3", "source: https://example.org")
            + "approved_by: кто-то\napproved_at: 2026-10-07\n"
        )
        write(tmp_path / "clinical-drafts", "ketone-strips.md", signed)
        write(tmp_path / "clinical-drafts", "broken.md", "нет заголовка вовсе")

        report = await reindex(session, root=tmp_path)

        assert report.ok
        assert report.documents == 1
        assert report.skipped_drafts == 0
        found = await kb.search(session, q="кетоны")
        assert {passage.doc_slug for passage in found} == {"how-to-record-ketones"}

    def test_only_product_and_clinical_paths(self, tmp_path: Path) -> None:
        write(tmp_path / "product", "a.md", PRODUCT)
        write(tmp_path / "product", "README.md", "# про каталог")
        write(tmp_path / "clinical", "b.md", PRODUCT)
        write(tmp_path / "clinical-drafts", "c.md", PRODUCT)
        write(tmp_path, "d.md", PRODUCT)

        names = [path.relative_to(tmp_path).as_posix() for path in article_paths(tmp_path)]

        assert names == ["clinical/b.md", "product/a.md"]


REPO_KB = Path(__file__).resolve().parents[3] / "docs" / "knowledge-base"


class TestRepositoryKnowledgeBase:
    """Статьи репозитория — те, что выкат положит в индекс."""

    def test_every_article_parses(self) -> None:
        paths = article_paths(REPO_KB)
        assert paths, "в product/ нет ни одной статьи — помощнику нечем отвечать"
        slugs = [read_article(path, root=REPO_KB).slug for path in paths]
        assert len(slugs) == len(set(slugs))

    def test_clinical_drafts_stay_unsigned_drafts(self) -> None:
        """Черновик подписывает медицинская команда, перенося файл в
        `clinical/`. Подпись внутри каталога черновиков — путаница: текст
        выглядит утверждённым и при этом не индексируется."""

        drafts = sorted((REPO_KB / "clinical-drafts").glob("*.md"))
        for path in drafts:
            if path.name == "README.md":
                continue
            head = path.read_text(encoding="utf-8").split("\n---\n", 1)[0]
            fields = dict(
                (key.strip(), value.strip())
                for key, _, value in (
                    line.partition(":") for line in head.splitlines()[1:] if ":" in line
                )
            )
            assert fields.get("kind") == "clinical", path.name
            assert fields.get("status") == "draft", path.name
            assert not fields.get("approved_by"), path.name
            assert not fields.get("approved_at"), path.name


class TestSearch:
    @pytest.mark.asyncio
    async def test_finds_by_any_word_form(self, session, tmp_path: Path) -> None:
        """Семья спрашивает живыми словами: «куда вписать кетоны» обязано
        находить статью, где написано «записать»."""

        write(tmp_path / "product", "how-to-record-ketones.md", PRODUCT)
        await reindex(session, root=tmp_path)

        found = await kb.search(session, q="куда вписать кетоны")

        assert found
        assert found[0].doc_slug == "how-to-record-ketones"

    @pytest.mark.asyncio
    async def test_unrelated_question_finds_nothing(self, session, tmp_path: Path) -> None:
        """Пустая выдача честнее случайной: на ней помощник не вызывает модель.

        Замер: «рецепт торта на день рождения» цеплялось за статью через одно
        случайное слово с соответствием 0.20 против 1.4-1.8 у настоящего
        попадания — отсюда порог.
        """

        write(tmp_path / "product", "how-to-record-ketones.md", PRODUCT)
        await reindex(session, root=tmp_path)

        assert await kb.search(session, q="рецепт торта на день рождения") == []

    @pytest.mark.asyncio
    async def test_empty_question_is_not_a_search(self, session) -> None:
        assert await kb.search(session, q="   ") == []
