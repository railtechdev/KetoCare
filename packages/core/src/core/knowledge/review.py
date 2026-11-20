"""Проверка черновика статьи постфильтром помощника (ADR-0093).

Помощник отвечает словами статей — часто почти дословно. Если кусок статьи сам
по себе срабатывает на постфильтре ответа, любой ответ, процитировавший его,
семья получит шаблоном отказа: статья выглядит опубликованной, а не работает.

Это **предупреждение, а не запрет.** Клинический текст законно говорит о
лекарствах и симптомах — так, как не вправе говорить модель от себя, — и решает
специалист: переписать раздел или опубликовать как есть, понимая, что по нему
помощник будет отвечать отказом. Поэтому находка называет раздел, предложение и
вид правила, а не только «нельзя».

Кусок режется той же функцией, что у индекса: проверяется ровно то, что прочтёт
модель.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..textguard.assistant_guard import check, check_answer
from .documents import split_text

#: Граница предложения в исходном тексте. Предложение показывается человеку как
#: написано, поэтому режется исходник, а не нормализованный текст фильтра.
_SENTENCE = re.compile(r"(?<=[.!?…])\s+|\n+")

#: Правило «в ответе нет текста»: на отдельной строке без прозы оно срабатывает
#: всегда и ни о чём не говорит.
_NO_TEXT = "в ответе нет текста"

#: Сколько символов предложения показывать в находке.
SENTENCE_PREVIEW = 300


@dataclass(frozen=True, slots=True)
class DraftWarning:
    #: Путь заголовков раздела: «Ребёнок заболел › Лекарства».
    section: str
    #: Предложение, на котором сработало правило, — или начало раздела, если
    #: правило сработало на разделе целиком (язык, связка двух предложений).
    sentence: str
    #: Вид правила: `dosing`, `therapy_change`, `symptom_reading`, `diagnosis`,
    #: `unreadable`, `internal`.
    kind: str
    #: Какое правило сработало, словами.
    rule: str


def draft_warnings(title: str, body: str) -> list[DraftWarning]:
    """Находки постфильтра по каждому разделу черновика; пусто — помех нет."""

    found: list[DraftWarning] = []
    for chunk in split_text(title, body):
        verdict = check_answer(chunk.body)
        if not verdict.blocked:
            continue
        found.append(
            DraftWarning(
                section=chunk.heading_path,
                sentence=_offending_sentence(chunk.body),
                kind=verdict.kind.value if verdict.kind is not None else "internal",
                rule=verdict.rule,
            )
        )
    return found


def _offending_sentence(body: str) -> str:
    """Первое предложение раздела, которое фильтр блокирует само по себе."""

    sentences = [part.strip() for part in _SENTENCE.split(body) if part.strip()]
    for sentence in sentences:
        if check(sentence).blocked:
            return sentence[:SENTENCE_PREVIEW]
    # Правило языка: ищется предложение не по-русски. Строка без букв прозы
    # («Telegram», «**1.**») сама по себе «без текста» и виновной не считается.
    for sentence in sentences:
        verdict = check_answer(sentence)
        if verdict.blocked and verdict.rule != _NO_TEXT:
            return sentence[:SENTENCE_PREVIEW]
    return (sentences[0] if sentences else body.strip())[:SENTENCE_PREVIEW]
