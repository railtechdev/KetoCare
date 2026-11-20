"""Статьи базы знаний в базе и их синхронизация с выпуском (ADR-0093).

Здесь проверяется то, на чём держится переезд статей в кабинет: опубликованная
редакция не меняется, второй прогон выката не меняет ничего, статью кабинета
выкат не трогает, клинический файл переносится один раз, а скрытая или снятая
статья исчезает из поиска помощника.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import select, text

from core.knowledge.documents import ArticleError, read_article, split_text
from core.knowledge.indexer import INDEX_LOCK_KEY, rebuild_index, reindex, reindex_article
from core.knowledge.review import draft_warnings
from core.knowledge.slugs import slug_base, with_suffix
from core.models import KbArticle, KbArticleVersion, KbChunk
from core.models.enums import UserRole
from core.models.knowledge import PublishedVersionImmutableError
from core.repositories import kb_articles as repo
from core.repositories import knowledge_base as kb
from core.repositories import users

from .test_knowledge_base import PRODUCT, clear_knowledge_base, write

CLINICAL = """---
id: sick-days
title: Ребёнок заболел
kind: clinical
status: approved
version: 1
source: https://example.org/illness
approved_by: Клиника
approved_at: 2026-10-22
---

# Ребёнок заболел

## Короткий ответ

При простуде ребёнка сообщите своей команде и следите, чтобы он пил воду.
"""


@pytest.fixture
async def session(session):
    await clear_knowledge_base(session)
    return session


@pytest.fixture
def release(tmp_path: Path) -> Path:
    write(tmp_path / "product", "how-to-record-ketones.md", PRODUCT)
    write(tmp_path / "clinical", "sick-days.md", CLINICAL)
    return tmp_path


async def _doctor(session, name: str = "Врач"):
    return await users.create(
        session,
        role=UserRole.DOCTOR,
        full_name=name,
        email=f"{name.lower()}-{id(session)}@example.org",
        password_hash="x",
    )


async def _snapshot(session) -> list[tuple]:
    """Всё, что синхронизация могла бы поменять, в сравнимом виде."""

    articles = (
        await session.execute(
            select(
                KbArticle.slug,
                KbArticle.status,
                KbArticle.hidden,
                KbArticle.live_version_id,
                KbArticle.updated_at,
            ).order_by(KbArticle.slug)
        )
    ).all()
    versions = (
        await session.execute(
            select(KbArticleVersion.id, KbArticleVersion.updated_at).order_by(KbArticleVersion.id)
        )
    ).all()
    chunks = (await session.execute(select(KbChunk.id).order_by(KbChunk.id))).all()
    return [tuple(articles), tuple(versions), tuple(chunks)]


class TestPublishedVersionIsImmutable:
    async def test_published_version_refuses_update(self, session, release: Path) -> None:
        await reindex(session, root=release)
        article = (await repo.by_slug(session))["sick-days"]
        published = await repo.working_version(session, article.id)

        published.body_md = "другой текст"
        with pytest.raises(PublishedVersionImmutableError):
            await session.flush()

    async def test_published_version_refuses_update_after_expiry(
        self, session, release: Path
    ) -> None:
        """После коммита поля объекта истекают: проверка обязана спросить базу,
        а не память объекта, иначе правка проходила бы молча."""

        await reindex(session, root=release)
        article = (await repo.by_slug(session))["sick-days"]
        published = await repo.working_version(session, article.id)
        session.expire(published, ["approved_at"])

        published.title = "Другой заголовок"
        with pytest.raises(PublishedVersionImmutableError):
            await session.flush()

    async def test_published_version_refuses_delete(self, session, release: Path) -> None:
        await reindex(session, root=release)
        article = (await repo.by_slug(session))["sick-days"]
        published = await repo.working_version(session, article.id)

        await session.delete(published)
        with pytest.raises(PublishedVersionImmutableError):
            await session.flush()

    async def test_draft_version_is_editable(self, session) -> None:
        doctor = await _doctor(session)
        article, draft = await repo.create(
            session,
            slug="draft-article",
            kind=repo.CLINICAL,
            origin=repo.CABINET,
            title="Черновик",
            body_md="Текст.",
            sources=None,
            created_by=doctor.id,
            author_id=doctor.id,
        )

        await repo.update_draft(
            session,
            article=article,
            draft=draft,
            title="Черновик 2",
            body_md="Новый текст.",
            sources=None,
            source_file_name=None,
        )

        assert draft.body_md == "Новый текст."
        assert article.title == "Черновик 2"


class TestReleaseSync:
    async def test_first_run_imports_and_indexes(self, session, release: Path) -> None:
        report = await reindex(session, root=release)

        assert report.ok
        assert report.builtin_added == 1
        assert report.clinical_imported == 1
        assert report.live_articles == 2
        stored = await repo.by_slug(session)
        assert stored["how-to-record-ketones"].origin == "builtin"
        assert stored["sick-days"].origin == "cabinet"
        assert stored["sick-days"].kind == "clinical"

    async def test_imported_clinical_keeps_its_signature(self, session, release: Path) -> None:
        await reindex(session, root=release)
        article = (await repo.by_slug(session))["sick-days"]

        first = await repo.working_version(session, article.id)

        assert first.number == 1
        assert first.approver_label == "Клиника"
        assert first.reviewed_by is None
        assert first.approved_at is not None and first.approved_at.date().isoformat() == (
            "2026-10-22"
        )
        assert first.sources == "https://example.org/illness"
        assert article.live_version_id == first.id

    async def test_second_run_changes_nothing(self, session, release: Path) -> None:
        await reindex(session, root=release)
        before = await _snapshot(session)

        report = await reindex(session, root=release)

        assert report.ok
        assert (report.builtin_added, report.builtin_updated, report.builtin_withdrawn) == (0, 0, 0)
        assert report.clinical_imported == 0
        assert (report.chunks, report.removed) == (0, 0)
        assert await _snapshot(session) == before

    async def test_clinical_file_is_imported_only_once(self, session, release: Path) -> None:
        """После переноса истина — в кабинете: другой текст файла не перезаписывает
        правку специалиста."""

        await reindex(session, root=release)
        write(
            release / "clinical",
            "sick-days.md",
            CLINICAL.replace("следите, чтобы он пил воду", "текст из файла поменялся"),
        )

        report = await reindex(session, root=release)

        assert report.clinical_imported == 0
        article = (await repo.by_slug(session))["sick-days"]
        assert len(await repo.versions(session, article.id)) == 1
        assert await kb.search(session, q="текст из файла поменялся") == []

    async def test_changed_builtin_file_becomes_a_new_version(self, session, release: Path) -> None:
        await reindex(session, root=release)
        write(
            release / "product",
            "how-to-record-ketones.md",
            PRODUCT.replace("с запятой, и с точкой", "через запятую и через точку"),
        )

        report = await reindex(session, root=release)

        assert report.builtin_updated == 1
        article = (await repo.by_slug(session))["how-to-record-ketones"]
        history = await repo.versions(session, article.id)
        assert [v.number for v in history] == [1, 2]
        assert all(v.approved_at is not None for v in history)
        assert history[-1].author_label == "KetoCare"
        assert article.live_version_id == history[-1].id
        found = await kb.search(session, q="через запятую")
        assert found and found[0].doc_slug == "how-to-record-ketones"

    async def test_builtin_gone_from_release_is_withdrawn(self, session, release: Path) -> None:
        await reindex(session, root=release)
        (release / "product" / "how-to-record-ketones.md").unlink()

        report = await reindex(session, root=release)

        assert report.builtin_withdrawn == 1
        article = (await repo.by_slug(session))["how-to-record-ketones"]
        assert article.status == "withdrawn"
        assert article.live_version_id is None
        assert await kb.search(session, q="кетоны") == []

    async def test_builtin_back_in_release_is_live_again(self, session, release: Path) -> None:
        await reindex(session, root=release)
        path = release / "product" / "how-to-record-ketones.md"
        path.unlink()
        await reindex(session, root=release)
        write(release / "product", "how-to-record-ketones.md", PRODUCT)

        await reindex(session, root=release)

        article = (await repo.by_slug(session))["how-to-record-ketones"]
        assert article.status == "published"
        assert len(await repo.versions(session, article.id)) == 1

    async def test_hidden_builtin_stays_hidden_and_out_of_search(
        self, session, release: Path
    ) -> None:
        await reindex(session, root=release)
        article = (await repo.by_slug(session))["how-to-record-ketones"]
        await repo.set_hidden(session, article=article, hidden=True)
        await reindex_article(session, article)
        assert await kb.search(session, q="кетоны") == []

        write(
            release / "product",
            "how-to-record-ketones.md",
            PRODUCT.replace("с запятой, и с точкой", "через запятую и через точку"),
        )
        report = await reindex(session, root=release)

        assert report.builtin_updated == 1
        assert article.hidden
        assert await kb.search(session, q="кетоны") == []

    async def test_cabinet_article_survives_the_release(self, session, release: Path) -> None:
        doctor = await _doctor(session)
        reviewer = await _doctor(session, "Диетолог")
        article, draft = await repo.create(
            session,
            slug="fasting-before-tests",
            kind=repo.CLINICAL,
            origin=repo.CABINET,
            title="Анализы натощак",
            body_md="## Коротко\n\nПеред анализами крови ребёнок соблюдает обычный режим питья.",
            sources=None,
            created_by=doctor.id,
            author_id=doctor.id,
        )
        await repo.publish(session, article=article, draft=draft, reviewed_by=reviewer.id)
        await reindex_article(session, article)

        report = await reindex(session, root=release)

        assert report.ok
        stored = (await repo.by_slug(session))["fasting-before-tests"]
        assert stored.status == "published"
        found = await kb.search(session, q="анализы натощак")
        assert any(p.doc_slug == "fasting-before-tests" for p in found)

    async def test_product_file_over_a_cabinet_slug_is_skipped_not_fatal(
        self, session, release: Path
    ) -> None:
        """Совпадение имени — не перезапись чужой статьи и не остановка выката:
        имя статьи кабинета выбирали люди, и выпуск о нём знать не мог."""

        doctor = await _doctor(session)
        await repo.create(
            session,
            slug="how-to-record-ketones",
            kind=repo.CLINICAL,
            origin=repo.CABINET,
            title="Чужая статья",
            body_md="Текст.",
            sources=None,
            created_by=doctor.id,
            author_id=doctor.id,
        )

        report = await reindex(session, root=release)

        assert report.ok, report.errors
        assert any("занято статьёй кабинета" in note for note in report.notes)
        assert report.builtin_added == 0
        stored = (await repo.by_slug(session))["how-to-record-ketones"]
        assert (stored.kind, stored.origin, stored.status) == ("clinical", "cabinet", "draft")
        assert await kb.article(session, "how-to-record-ketones") is None

    async def test_same_slug_in_product_and_clinical_files_is_an_error(
        self, session, release: Path
    ) -> None:
        write(
            release / "clinical",
            "how-to-record-ketones.md",
            CLINICAL.replace("id: sick-days", "id: how-to-record-ketones"),
        )

        report = await reindex(session, root=release)

        assert not report.ok
        assert any("уже занят" in error for error in report.errors)
        assert await repo.by_slug(session) == {}

    async def test_clinical_file_over_a_product_article_is_not_imported(
        self, session, release: Path
    ) -> None:
        await reindex(session, root=release)
        write(
            release / "clinical",
            "how-to-record-ketones.md",
            CLINICAL.replace("id: sick-days", "id: how-to-record-ketones"),
        )
        (release / "product" / "how-to-record-ketones.md").unlink()

        report = await reindex(session, root=release)

        assert report.ok, report.errors
        assert report.clinical_imported == 0
        assert any("занято продуктовой статьёй" in note for note in report.notes)
        assert (await repo.by_slug(session))["how-to-record-ketones"].kind == "product"


class TestClinicalImportIsOneTime:
    """Клинические файлы переносятся один раз; дальше — только кабинет.

    Иначе каталог `clinical/` остался бы каналом публикации семьям мимо
    четырёх глаз: любой новый подписанный по форме файл уезжал бы в помощник
    ближайшим выкатом.
    """

    async def test_new_clinical_file_after_the_import_is_not_published(
        self, session, release: Path
    ) -> None:
        await reindex(session, root=release)
        write(
            release / "clinical",
            "ketone-strips.md",
            CLINICAL.replace("id: sick-days", "id: ketone-strips").replace(
                "следите, чтобы он пил воду", "полоски хранят в сухом месте"
            ),
        )

        report = await reindex(session, root=release)

        assert report.ok, report.errors
        assert report.clinical_imported == 0
        assert any("ketone-strips.md" in note for note in report.notes)
        assert "ketone-strips" not in await repo.by_slug(session)
        assert await kb.search(session, q="полоски хранят в сухом месте") == []

    async def test_cabinet_articles_do_not_count_as_the_import(
        self, session, release: Path
    ) -> None:
        """Статья, заведённая врачом до первого прогона, перенос не отменяет:
        перенесённую редакцию отличает подпись выпуска, а не вид статьи."""

        doctor = await _doctor(session)
        await repo.create(
            session,
            slug="written-in-the-cabinet",
            kind=repo.CLINICAL,
            origin=repo.CABINET,
            title="Своя статья",
            body_md="Текст.",
            sources=None,
            created_by=doctor.id,
            author_id=doctor.id,
        )

        report = await reindex(session, root=release)

        assert report.clinical_imported == 1

    async def test_clinical_kind_outside_its_folder_is_an_error(
        self, session, release: Path
    ) -> None:
        """Хук защищает только `clinical/`: клиническая статья в `product/`
        иначе прошла бы и мимо него, и мимо проверки специалистом."""

        write(
            release / "product",
            "smuggled.md",
            CLINICAL.replace("id: sick-days", "id: smuggled"),
        )

        report = await reindex(session, root=release)

        assert not report.ok
        assert any("smuggled.md" in error and "каталогом" in error for error in report.errors)
        assert await repo.by_slug(session) == {}

    def test_product_kind_inside_clinical_is_an_error(self, tmp_path: Path) -> None:
        path = write(tmp_path / "clinical", "how-to-record-ketones.md", PRODUCT)

        with pytest.raises(ArticleError, match="каталогом"):
            read_article(path, root=tmp_path)


class TestIndexLock:
    """Выкат и запись статьи в кабинете не перемешиваются (ADR-0093)."""

    async def test_reindex_holds_the_index_lock(self, session, release: Path) -> None:
        await reindex(session, root=release)

        held = await session.scalar(
            text(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' "
                "AND pid = pg_backend_pid() AND classid = 0 AND objid = :key "
                "AND objsubid = 1 AND granted"
            ),
            {"key": INDEX_LOCK_KEY},
        )

        assert held == 1

    async def test_rebuild_reads_the_article_again(self, session, release: Path) -> None:
        """Статья, снятая другой транзакцией после загрузки в эту сессию, не
        возвращается в индекс из устаревшего объекта."""

        await reindex(session, root=release)
        article = (await repo.by_slug(session))["sick-days"]
        assert article.live_version_id is not None
        # Чужая транзакция: снятие мимо карты идентичности этой сессии.
        await session.execute(
            text(
                "UPDATE kb_articles SET live_version_id = NULL, status = 'withdrawn' WHERE id = :id"
            ),
            {"id": article.id},
        )
        await session.execute(
            text("DELETE FROM kb_chunks WHERE article_id = :id"), {"id": article.id}
        )

        await rebuild_index(session)

        assert await kb.article(session, "sick-days") is None


class TestReindexArticle:
    async def test_withdrawn_article_leaves_the_index_at_once(self, session, release: Path) -> None:
        await reindex(session, root=release)
        article = (await repo.by_slug(session))["sick-days"]
        assert await kb.article(session, "sick-days") is not None

        await repo.withdraw(session, article=article)
        added, removed = await reindex_article(session, article)

        assert (added, removed) == (0, 1)
        assert await kb.article(session, "sick-days") is None

    async def test_pending_draft_keeps_the_live_version_in_the_index(
        self, session, release: Path
    ) -> None:
        """Черновик правки не заменяет опубликованный текст до публикации."""

        await reindex(session, root=release)
        article = (await repo.by_slug(session))["sick-days"]
        doctor = await _doctor(session)
        await repo.add_version(
            session,
            article=article,
            number=2,
            title="Ребёнок заболел",
            body_md="## Короткий ответ\n\nНовый черновой текст про болезнь.",
            sources=None,
            author_id=doctor.id,
        )

        await reindex_article(session, article)

        found = await kb.article(session, "sick-days")
        assert found is not None
        assert "следите, чтобы он пил воду" in found.body_md
        assert "черновой" not in found.body_md


class TestSlugs:
    @pytest.mark.parametrize(
        ("title", "slug"),
        [
            ("Ребёнок заболел — простуда, температура", "rebyonok-zabolel-prostuda-temperatura"),
            ("Щи и борщ", "shchi-i-borshch"),
            ("  !!!  ", "article"),
            ("Кетоны 2026", "ketony-2026"),
        ],
    )
    def test_slug_from_title(self, title: str, slug: str) -> None:
        assert slug_base(title) == slug

    def test_long_title_is_cut_at_a_word(self) -> None:
        slug = slug_base("очень длинный заголовок " * 10)
        assert len(slug) <= 80
        assert not slug.endswith("-")

    def test_suffixes(self) -> None:
        assert [with_suffix("a", n) for n in (1, 2, 3)] == ["a", "a-2", "a-3"]


class TestDraftWarnings:
    def test_clean_text_has_no_warnings(self) -> None:
        assert draft_warnings("Анализы", "## Коротко\n\nЗапишите дату анализа в дневник.") == []

    def test_dose_is_named_with_section_and_sentence(self) -> None:
        body = (
            "## Коротко\n\nЗапишите дату анализа в дневник.\n\n"
            "## Лекарства\n\nОбычно это безопасно. Давайте 300 мг утром."
        )

        found = draft_warnings("Анализы", body)

        assert len(found) == 1
        assert found[0].section == "Анализы › Лекарства"
        assert found[0].sentence == "Давайте 300 мг утром."
        assert found[0].kind == "dosing"
        assert found[0].rule

    def test_foreign_language_section_is_named(self) -> None:
        found = draft_warnings("Статья", "## Раздел\n\nKechqurun yarim tabletka bering.")

        assert [w.kind for w in found] == ["unreadable"]
        assert found[0].sentence.startswith("Kechqurun")


class TestSplitText:
    """Text outside the `##` sections reaches the index too (ADR-0093).

    Files never have it (H1, then sections), but an article written in the
    cabinet often does: an introduction before the first section, or a Word
    document whose sections are «Заголовок 1». Dropping it would publish text
    the model never sees.
    """

    def test_introduction_before_the_first_section_is_kept(self) -> None:
        chunks = split_text("Анализы", "Вступление.\n\n## Раздел\n\nТекст раздела.")

        assert [(c.heading_path, c.body) for c in chunks] == [
            ("Анализы", "Вступление."),
            ("Анализы › Раздел", "Текст раздела."),
        ]

    def test_top_level_sections_are_kept(self) -> None:
        chunks = split_text("Анализы", "# Первое\n\nОдин.\n\n# Второе\n\nДва.")

        assert [(c.heading_path, c.body) for c in chunks] == [
            ("Анализы › Первое", "Один."),
            ("Анализы › Второе", "Два."),
        ]

    def test_title_heading_is_not_repeated_in_the_path(self) -> None:
        chunks = split_text("Анализы", "# Анализы\n\nТолько текст.")

        assert [(c.heading_path, c.body) for c in chunks] == [("Анализы", "Только текст.")]

    def test_repository_articles_have_no_text_outside_sections(self) -> None:
        """For the files nothing changed: every chunk is a `##` section."""

        from core.knowledge.documents import article_paths, read_article, split_article

        root = Path(__file__).resolve().parents[3] / "docs" / "knowledge-base"
        for path in article_paths(root):
            article = read_article(path, root=root)
            for chunk in split_article(article):
                assert chunk.heading_path.startswith(f"{article.title} › "), path.name
