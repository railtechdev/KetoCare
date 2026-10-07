"""Постфильтр помощника: последняя линия перед семьёй (раздел 10.4 ТЗ).

Проверяется корпусом, а не отдельными случаями: правило, подогнанное под одну
фразу, ломает соседние, и заметно это только на списке целиком.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from worker.ai.guard import RUSSIAN_SHARE_MIN, Kind, Verdict, check, check_answer

CASES = Path(__file__).parent / "data" / "assistant_guard_cases.yaml"


def _load() -> dict[str, list[dict[str, Any]]]:
    """Разбор корпуса без внешнего YAML: формат плоский и наш собственный."""

    data: dict[str, list[dict[str, Any]]] = {"must_block": [], "must_pass": []}
    section: str | None = None
    current: dict[str, Any] | None = None

    for raw in CASES.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if line in ("must_block:", "must_pass:"):
            section = line[:-1]
            continue
        if section is None:
            continue
        if line.lstrip().startswith("- "):
            current = {}
            data[section].append(current)
            line = line.replace("- ", "", 1)
        if current is None:
            continue
        key, _, value = line.strip().partition(":")
        current[key.strip()] = value.strip()

    return data


CORPUS = _load()


@pytest.mark.parametrize(
    "case", CORPUS["must_block"], ids=[c["text"][:40] for c in CORPUS["must_block"]]
)
def test_forbidden_answers_are_blocked(case: dict[str, Any]) -> None:
    verdict = check_answer(case["text"])

    assert verdict.blocked, f"пропущено: {case['text']} ({case['why']})"
    assert verdict.kind == Kind(case["kind"]), (
        f"класс не тот: ждали {case['kind']}, получили {verdict.kind}"
    )


@pytest.mark.parametrize(
    "case", CORPUS["must_pass"], ids=[c["text"][:40] for c in CORPUS["must_pass"]]
)
def test_useful_answers_pass(case: dict[str, Any]) -> None:
    """Ложное срабатывание не бесплатно: помощник, отвечающий шаблоном на
    «куда вписать кетоны», бесполезен, и семья перестаёт им пользоваться."""

    verdict = check_answer(case["text"])

    assert not verdict.blocked, (
        f"заблокировано зря: {case['text']} ({case['why']}); правило {verdict.rule}"
    )


class TestCorpusItself:
    def test_corpus_is_not_empty_on_either_side(self) -> None:
        """Корпус с одними запретами превращает фильтр в «блокировать всё»."""

        assert len(CORPUS["must_block"]) >= 10
        assert len(CORPUS["must_pass"]) >= 8

    def test_every_class_is_covered(self) -> None:
        kinds = {case["kind"] for case in CORPUS["must_block"]}
        assert kinds == {
            Kind.DOSING.value,
            Kind.THERAPY_CHANGE.value,
            Kind.SYMPTOM_READING.value,
            Kind.DIAGNOSIS.value,
            Kind.UNREADABLE.value,
        }


class TestFailClosed:
    def test_internal_error_blocks(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Сломавшийся фильтр не должен превращаться в открытую дверь."""

        import worker.ai.guard as guard

        def boom(_: str) -> Verdict:
            raise RuntimeError("правило сломалось")

        monkeypatch.setattr(guard, "_check", boom)

        verdict = guard.check("любой текст")

        assert verdict.blocked
        assert verdict.kind == Kind.INTERNAL

    def test_markup_does_not_hide_a_dose(self) -> None:
        assert check("Принимайте **300 мг** утром").blocked

    def test_yo_is_not_an_escape(self) -> None:
        """«ё» в одном месте и «е» в другом — не повод пропустить ответ."""

        assert check("У вашего ребёнка судороги, вероятно, из-за кетоза").blocked


class TestLanguage:
    """Ответ не по-русски не читается правилами — и не показывается (ADR-0021)."""

    def test_question_in_uzbek_is_not_refused(self) -> None:
        """Вопрос — не ответ: узбекский вопрос не запрет (ADR-0052)."""

        assert not check("Ketonlarni qayerga yozaman?").blocked

    def test_answer_without_letters_is_blocked(self) -> None:
        assert check_answer("[[kb:diary]] 3,2").kind == Kind.UNREADABLE

    def test_threshold_leaves_room_on_both_sides(self) -> None:
        """Порог выбран с запасом: русский ответ с латиницей — выше, узбекский с
        русскими цитатами — ниже, и ни один не стоит у самой границы."""

        assert 0.5 <= RUSSIAN_SHARE_MIN <= 0.7

    def test_language_check_failure_blocks(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import worker.ai.guard as guard

        def boom(_: str) -> Verdict:
            raise RuntimeError("правило сломалось")

        monkeypatch.setattr(guard, "_russian", boom)

        assert guard.check_answer("Кетоны записываются кнопкой").kind == Kind.INTERNAL

    def test_foreign_list_item_on_its_own_line_is_blocked(self) -> None:
        """Пункт списка с новой строки — то же предложение, что после точки (Н3)."""

        answer = "Записывайте кетоны каждый день в разделе «Дневник»\n- Dori bering"

        verdict = check_answer(answer)

        assert verdict.kind == Kind.UNREADABLE
        assert verdict.rule == "предложение не на русском"

    def test_short_latin_name_alone_does_not_vote(self) -> None:
        """Одинокое название пунктом списка короче порога — не предложение."""

        assert not check_answer("Кетоны записываются в разделе «Дневник».\n- Fit.").blocked

    def test_sentence_threshold_is_not_above_the_answer_threshold(self) -> None:
        """В одном предложении латинское название весит больше, чем в ответе."""

        from worker.ai.guard import SENTENCE_RUSSIAN_SHARE_MIN

        assert SENTENCE_RUSSIAN_SHARE_MIN <= RUSSIAN_SHARE_MIN
