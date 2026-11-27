"""Постфильтр сводки против золотого корпуса.

Корпус — `data/summary_guard_cases.yaml`. Половина «должно пройти» здесь важнее
половины «должно заблокировать»: сводка обязана пересказывать дозы, даты смены
назначения и числа приверженности, и фильтр, ошибающийся в эту сторону,
забракует каждый честный черновик — функция окажется неработоспособной, а
выглядеть это будет как поломка ИИ.
"""

from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

import pytest
import yaml
from hypothesis import given, settings
from hypothesis import strategies as st

from core.textguard import Kind, check, has_hard
from core.textguard.summary_guard import HARD_KINDS

CASES: dict[str, Any] = yaml.safe_load(
    (Path(__file__).parent / "data" / "summary_guard_cases.yaml").read_text(encoding="utf-8")
)

#: Все шесть разделов раздела 10.5: корпус проверяет правила, а не структуру, и
#: без обёртки каждый случай приносил бы находку «нет разделов».
SECTIONS = (
    "## Приступы\n{text}\n"
    "## Кетоны\nданных за период нет\n"
    "## Вес\nданных за период нет\n"
    "## Питание\nданных за период нет\n"
    "## Приверженность\nданных за период нет\n"
    "## Замечания по данным\nданных за период нет\n"
)


@pytest.mark.parametrize("case", CASES["must_block"], ids=lambda case: case["text"][:60])
def test_blocks(case: dict[str, str]) -> None:
    findings = check(SECTIONS.format(text=case["text"]))
    kinds = {finding.kind.value for finding in findings}
    assert case["kind"] in kinds, f"не сработало: {case['why']}; нашлось {kinds}"


@pytest.mark.parametrize("case", CASES["must_pass"], ids=lambda case: case["text"][:60])
def test_passes(case: dict[str, str]) -> None:
    findings = check(SECTIONS.format(text=case["text"]))
    assert not findings, f"ложное срабатывание ({case['why']}): {[f.matched for f in findings]}"


class TestStructure:
    def test_missing_section_is_a_finding(self) -> None:
        findings = check("## Приступы\nЗа период записано 14 приступов.\n")
        assert [finding.kind for finding in findings] == [Kind.STRUCTURE]

    def test_missing_section_does_not_block_approval(self) -> None:
        """Структура — предупреждение, а не запрет.

        Врач видит, что раздела нет, и решает сам; запрещать утверждение из-за
        формата значило бы блокировать сводку, с которой всё в порядке по сути.
        """

        assert not has_hard(check("## Приступы\nЗа период записано 14 приступов.\n"))

    def test_all_six_sections_pass(self) -> None:
        assert not check(SECTIONS.format(text="данных за период нет"))


class TestScope:
    def test_features_from_different_sentences_do_not_glue(self) -> None:
        """Признаки из разных предложений не складываются в находку.

        Постфильтр помощника смотрит текст целиком, и на шести разделах это
        давало ложные срабатывания: «судороги 14.08» из «Приступов» и «из-за
        поездки» из «Замечаний» — каждая строка безобидна, вместе они читались
        как толкование симптома.
        """

        text = SECTIONS.format(text="Зафиксированы судороги 14.08.").replace(
            "## Замечания по данным\nданных за период нет",
            "## Замечания по данным\nЗаписей нет с 20 по 22.08.",
        )
        assert not check(text)

    def test_causal_link_inside_one_sentence_is_a_finding(self) -> None:
        text = SECTIONS.format(text="Приступов стало меньше из-за увеличения дозы.")
        assert Kind.CAUSAL_READING in {finding.kind for finding in check(text)}


class TestFailClosed:
    def test_broken_rule_blocks_approval(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Сломавшийся фильтр не превращается в открытую дверь.

        Ошибка внутри правила даёт находку класса `internal`, а он жёсткий:
        текст, который никто не проверил, клиническим документом не становится.
        """

        def boom(_: str) -> list[str]:
            raise RuntimeError("правило сломалось")

        monkeypatch.setattr("core.textguard.summary_guard.sentences", boom)
        findings = check(SECTIONS.format(text="что угодно"))
        assert [finding.kind for finding in findings] == [Kind.INTERNAL]
        assert has_hard(findings)

    def test_internal_is_hard(self) -> None:
        assert Kind.INTERNAL in HARD_KINDS


# The sentence split was rewritten as a loop to stop backtracking quadratically
# on long runs of «!» (CodeQL py/polynomial-redos). The split must stay the
# same: the guard pairs signals within a sentence, and a different cut changes
# verdicts. The alphabet includes a non-ASCII digit and a non-breaking space:
# the regex classes `\d` and `\s` are Unicode-aware, and so must the loop be.
_PREVIOUS_SPLIT = re.compile(r"(?<![\d])[.!?]+(?=\s|$)|\n+")


@given(st.text(alphabet="аб1 9٣.!?\n\t ", max_size=40))
@settings(max_examples=3000, deadline=None)
def test_sentence_split_matches_the_previous_rule(text: str) -> None:
    from core.textguard.textscan import _split_sentences

    assert _split_sentences(text) == _PREVIOUS_SPLIT.split(text)


def test_sentence_split_is_linear_on_a_long_run() -> None:
    from core.textguard.textscan import sentences

    started = time.perf_counter()
    sentences("приступ" + "!" * 50_000 + "x")
    assert time.perf_counter() - started < 1.0
