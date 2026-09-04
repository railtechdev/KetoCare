"""Постфильтр помощника: последняя линия перед семьёй (раздел 10.4 ТЗ).

ТЗ требует держать четыре запрета «в промпте и постфильтре»: дозировки,
изменение диеты и лекарств, интерпретация симптомов, диагнозы. Здесь — вторая
половина. Первая (промпт) не заменяет её: промпт — это просьба, а модель
меняется, обновляется и ошибается, и цена ошибки здесь — родитель, который
выполнит совет про лекарство ребёнка с эпилепсией.

**Ни один класс не ловится одним словом.** «Мг» встречается в безобидном «в
100 г масла 82 г жира»; доза бывает без цифр вовсе — «по половине таблетки на
ночь». Поэтому каждое правило перемножает два признака: что говорят и о чём.
Списки признаков — в `lexicons.py`.

Ошибаться этот фильтр обязан в сторону блокировки: ложное срабатывание стоит
семье шаблонного ответа вместо полезного, ложный пропуск — выполненного совета
о лекарстве. Поэтому внутренняя ошибка тоже блокирует (`fail-closed`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from core.textguard import find_any as _any
from core.textguard import normalize as _normalize

from .lexicons import (
    ABOUT_THE_CHILD,
    CHANGE_VERBS,
    DIAGNOSES,
    DOSE_FORMS,
    DOSE_UNITS,
    INTERPRETATION,
    PRESCRIPTIVE,
    SCHEDULE,
    SOFT_UNITS,
    SYMPTOMS,
    THERAPY_OBJECTS,
)


class Kind(StrEnum):
    DOSING = "dosing"
    THERAPY_CHANGE = "therapy_change"
    SYMPTOM_READING = "symptom_reading"
    DIAGNOSIS = "diagnosis"
    INTERNAL = "internal"


@dataclass(frozen=True, slots=True)
class Verdict:
    blocked: bool
    kind: Kind | None = None
    #: Какое правило сработало — для журнала и разбора ложных срабатываний.
    rule: str = ""
    #: Что именно совпало. В журнал, не человеку.
    matched: str = ""


PASSED = Verdict(blocked=False)

_NUMBER_UNIT = re.compile(
    r"\b\d+[\d.,]*\s*(?:" + "|".join(DOSE_UNITS) + r")\b",
    re.IGNORECASE,
)


def check(text: str) -> Verdict:
    """Проверить ответ модели перед показом семье.

    Возвращает вердикт, а не исправленный текст: «подчистить» ответ значит
    оставить его же, но без предупреждающих слов. Заблокированный ответ
    заменяется шаблоном целиком.
    """

    try:
        return _check(_normalize(text))
    except Exception:  # noqa: BLE001 — фильтр падает в сторону запрета
        # Сломавшийся фильтр не должен превращаться в открытую дверь: ответа,
        # который никто не проверил, семья не увидит.
        return Verdict(blocked=True, kind=Kind.INTERNAL, rule="fail-closed")


def _check(text: str) -> Verdict:
    dosing = _dosing(text)
    if dosing.blocked:
        return dosing

    change = _therapy_change(text)
    if change.blocked:
        return change

    diagnosis = _diagnosis(text)
    if diagnosis.blocked:
        return diagnosis

    return _symptom_reading(text)


def _dosing(text: str) -> Verdict:
    """Доза: единица лекарства с числом ИЛИ форма выпуска с указанием."""

    match = _NUMBER_UNIT.search(text)
    if match is not None:
        return Verdict(True, Kind.DOSING, "число + единица дозы", match.group(0))

    form = _any(text, DOSE_FORMS + SOFT_UNITS)
    if form is None:
        return PASSED

    instruction = _any(text, PRESCRIPTIVE) or _any(text, SCHEDULE)
    if instruction is not None:
        return Verdict(True, Kind.DOSING, "форма выпуска + указание", f"{form} + {instruction}")
    return PASSED


def _therapy_change(text: str) -> Verdict:
    """Изменение назначенного: глагол изменения плюс то, что менять нельзя."""

    verb = _any(text, CHANGE_VERBS)
    if verb is None:
        return PASSED

    obj = _any(text, THERAPY_OBJECTS)
    if obj is None:
        return PASSED
    return Verdict(True, Kind.THERAPY_CHANGE, "изменение назначенного", f"{verb} + {obj}")


def _diagnosis(text: str) -> Verdict:
    """Диагноз: название состояния, отнесённое к ребёнку."""

    name = _any(text, DIAGNOSES)
    if name is None:
        return PASSED

    about = _any(text, ABOUT_THE_CHILD)
    if about is None:
        return PASSED
    return Verdict(True, Kind.DIAGNOSIS, "состояние + отнесение к ребёнку", f"{name} + {about}")


def _symptom_reading(text: str) -> Verdict:
    """Толкование симптома: симптом плюс объяснение или успокоение."""

    symptom = _any(text, SYMPTOMS)
    if symptom is None:
        return PASSED

    reading = _any(text, INTERPRETATION)
    if reading is None:
        return PASSED
    return Verdict(True, Kind.SYMPTOM_READING, "симптом + толкование", f"{symptom} + {reading}")
