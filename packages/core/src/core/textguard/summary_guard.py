"""Постфильтр сводки: что в ней нашлось лишнего (раздел 10.5 ТЗ).

Отличий от постфильтра помощника (`guard.py`) три, и каждое вытекает из того,
кто читает текст.

**Вердикт — список находок, а не «блокировать целиком».** Помощник заменяет
ответ шаблоном: семья не должна увидеть непроверенный текст. Врач должен —
иначе он не отличит «модель написала лишнее» от «система сломалась», а разбирать
ложные срабатывания станет нечем. Поэтому черновик сохраняется всегда, вместе с
находками, а запрет стоит на утверждении: текст с находкой жёсткого класса
нельзя перевести в `approved_md`, откуда он попал бы в отчёт и PDF.

**Единица проверки — предложение.** У помощника ответ в два-четыре предложения,
и разницы нет. Сводка — шесть разделов, и правило «признак А рядом с признаком
Б» на целом документе срабатывает случайно: «судороги 14.08» из «Приступов»
склеивается с «из-за поездки» из «Замечаний по данным».

**Правила доз нет.** Раздел 10.5 включает лекарственные отметки во вход, и
«депакин 300 мг — 26 отметок из 30» обязано пройти. Доза, названная врачу,
который её и назначил, — не тот вред, от которого защищается `_dosing`.

Разбор ложных срабатываний и корпус — `packages/core/tests/data/summary_guard_cases.yaml`.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .summary_lexicons import (
    ABOUT_DATA,
    ABOUT_THE_CHILD,
    ACTIONS,
    CAUSAL,
    CLINICAL_OBJECTS,
    DIAGNOSES,
    EVALUATION,
    EVALUATION_WEAK,
    MODAL,
    MODAL_WEAK,
    REQUIRED_SECTIONS,
)
from .textscan import find_any, normalize, sentences


class Kind(StrEnum):
    RECOMMENDATION = "recommendation"
    EVALUATION = "evaluation"
    CAUSAL_READING = "causal_reading"
    DIAGNOSIS = "diagnosis"
    STRUCTURE = "structure"
    INTERNAL = "internal"


#: Классы, при которых сводку нельзя утвердить. Рекомендация и суждение о
#: причине — то, ради чего постфильтр существует: врач читает сводку между
#: приёмами, и незамеченная строка «стоит увеличить соотношение» уедет в
#: `approved_md`, а оттуда в PDF. Внутренняя ошибка фильтра тоже здесь: текст,
#: который никто не проверил, клиническим документом не становится.
#:
#: Структура и оценочная лексика — предупреждение: врач видит находку и решает
#: сам. Разделение на жёсткие и мягкие классы — вопрос 38 медкоманде.
HARD_KINDS: frozenset[Kind] = frozenset(
    {Kind.RECOMMENDATION, Kind.CAUSAL_READING, Kind.DIAGNOSIS, Kind.INTERNAL}
)


@dataclass(frozen=True, slots=True)
class Finding:
    kind: Kind
    #: Почему сработало — код правила для интерфейса, не русская фраза: тексты
    #: живут в словарях фронтенда (правило 8 CLAUDE.md).
    rule: str
    #: Предложение, в котором нашлось. Врач должен видеть, что подсвечено.
    fragment: str
    #: Что именно совпало — для разбора ложных срабатываний.
    matched: str = ""

    @property
    def hard(self) -> bool:
        return self.kind in HARD_KINDS

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind.value,
            "rule": self.rule,
            "fragment": self.fragment,
            "matched": self.matched,
            "hard": self.hard,
        }


def check(text: str) -> list[Finding]:
    """Найти в сводке всё, чему в ней быть не положено.

    Пустой список — сводка прошла. Ошибка внутри фильтра возвращает находку
    класса `internal`: непроверенный текст утвердить нельзя (fail-closed), но и
    выбрасывать его не за что — врач увидит и текст, и причину.
    """

    try:
        return _check(text)
    except Exception as error:  # noqa: BLE001 — фильтр падает в сторону запрета
        return [Finding(Kind.INTERNAL, "fail-closed", "", str(error)[:200])]


def has_hard(findings: list[Finding]) -> bool:
    return any(finding.hard for finding in findings)


def _check(text: str) -> list[Finding]:
    findings: list[Finding] = []

    missing = _missing_sections(text)
    if missing:
        findings.append(Finding(Kind.STRUCTURE, "missing_sections", "", ", ".join(sorted(missing))))

    for sentence in sentences(text):
        for rule in (_recommendation, _evaluation, _causal, _diagnosis):
            finding = rule(sentence)
            if finding is not None:
                findings.append(finding)
                # Одного класса на предложение достаточно: врачу нужно знать, что
                # с этой строкой не так, а не сколько признаков в ней совпало.
                break

    return findings


def _missing_sections(text: str) -> set[str]:
    """Разделы раздела 10.5, которых в тексте нет.

    Промпт требует ровно шесть заголовков и оставлять пустой раздел со строкой
    «данных за период нет»: пропущенный раздел читается как «там всё в порядке»,
    а это разные вещи.
    """

    normalized = normalize(text)
    return {section for section in REQUIRED_SECTIONS if section not in normalized}


def _recommendation(sentence: str) -> Finding | None:
    strong = find_any(sentence, MODAL)
    if strong is not None:
        return Finding(Kind.RECOMMENDATION, "modal", sentence, strong)

    weak = find_any(sentence, MODAL_WEAK)
    if weak is None:
        return None
    action = find_any(sentence, ACTIONS)
    if action is None:
        return None
    return Finding(Kind.RECOMMENDATION, "modal_action", sentence, f"{weak} + {action}")


def _evaluation(sentence: str) -> Finding | None:
    strong = find_any(sentence, EVALUATION)
    if strong is not None:
        return Finding(Kind.EVALUATION, "evaluation", sentence, strong)

    weak = find_any(sentence, EVALUATION_WEAK)
    if weak is None:
        return None
    if find_any(sentence, ABOUT_DATA) is not None:
        # Предложение о качестве данных: «замеров за неделю недостаточно» — это
        # раздел «Замечания по данным», а не суждение о ребёнке.
        return None
    obj = find_any(sentence, CLINICAL_OBJECTS)
    if obj is None:
        return None
    return Finding(Kind.EVALUATION, "evaluation_object", sentence, f"{weak} + {obj}")


def _causal(sentence: str) -> Finding | None:
    link = find_any(sentence, CAUSAL)
    if link is None:
        return None
    return Finding(Kind.CAUSAL_READING, "causal", sentence, link)


def _diagnosis(sentence: str) -> Finding | None:
    name = find_any(sentence, DIAGNOSES)
    if name is None:
        return None
    about = find_any(sentence, ABOUT_THE_CHILD)
    if about is None:
        return None
    return Finding(Kind.DIAGNOSIS, "diagnosis", sentence, f"{name} + {about}")
