"""Статьи базы знаний проходят постфильтр помощника (раздел 10.4 ТЗ).

Помощник отвечает словами статей — часто почти дословно. Если кусок статьи сам
по себе срабатывает на постфильтре (`check_answer`), любой ответ, процитировавший
его, будет заменён шаблоном «обсудите с врачом», и семья получит отказ на
обычный вопрос про кнопку. Такая статья выглядит наполненной, а не работает.

Проверяется каждый кусок — ровно в том виде, в каком он уходит модели.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from core.knowledge.documents import article_paths, read_article, split_article
from worker.ai.guard import check, check_answer

REPO_KB = Path(__file__).resolve().parents[3] / "docs" / "knowledge-base"


def _chunks() -> list[tuple[str, str, str]]:
    found: list[tuple[str, str, str]] = []
    for path in article_paths(REPO_KB):
        article = read_article(path, root=REPO_KB)
        if article.status != "approved":
            continue
        for chunk in split_article(article):
            found.append((f"{article.slug}-{chunk.ord}", chunk.heading_path, chunk.body))
    return found


CHUNKS = _chunks()


def test_there_is_something_to_check() -> None:
    assert len(CHUNKS) > 20


@pytest.mark.parametrize(
    ("where", "body"), [(w, b) for _, w, b in CHUNKS], ids=[i for i, _, _ in CHUNKS]
)
def test_article_chunk_passes_the_answer_filter(where: str, body: str) -> None:
    verdict = check_answer(body)
    assert not verdict.blocked, f"{where}: {verdict.rule} — {verdict.matched}"


#: Обычные вопросы семьи о приложении. Фильтр вопроса не должен отказывать в
#: них до поиска: на такие вопросы и написаны статьи.
EVERYDAY_QUESTIONS = (
    "Как добавить запись в дневник в приложении?",
    "Как отметить, что ребёнок поел?",
    "Почему нельзя отметить завтрашний обед съеденным?",
    "Как переключиться на второго ребёнка в боте?",
    "Как пригласить бабушку?",
    "Как включить узбекский язык?",
    "Как скачать отчёт для врача?",
    "Как загрузить выписку?",
    "Что будет, если пропал интернет?",
    "Кто читает мои вопросы помощнику?",
    "Как сбросить пароль от кабинета?",
    "Как записать приступ?",
)


@pytest.mark.parametrize("question", EVERYDAY_QUESTIONS)
def test_everyday_question_is_not_refused(question: str) -> None:
    assert not check(question).blocked
