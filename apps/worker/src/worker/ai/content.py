"""Черновик карточки рецепта (раздел 10.1 ТЗ, `content_draft`, п. 21 этапа 4).

Опасность здесь не такая, как у сводки и помощника, и воронка из неё:

1. **Состав закрыт.** Ингредиенты подобрал специалист, а посчитало ядро;
   дописанный моделью продукт ломает и соотношение, и калорийность. Поэтому
   модель получает готовый список и не имеет права его менять — а проверка
   `grounding` следит, чтобы в тексте не появилось чужих граммовок.
2. **Ничего не сохраняется.** Ответ — черновик: администратор или диетолог
   читает его, правит и сохраняет обычной формой рецепта. Правило 6 CLAUDE.md
   здесь выполняется самой формой работы, без отдельного подтверждения.
3. **Лечебных обещаний нет.** «Помогает удерживать кетоз» в карточке блюда —
   утверждение, которого никто не давал; его ловит общий постфильтр
   (`core.textguard`), тот же, что проверяет сводку, но без требования шести
   разделов — у карточки своя форма.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from core.models.enums import AiJobKind
from core.textguard import find_any, normalize
from core.textguard import summary_guard as sguard

from . import grounding
from .client import AiClient, AiError, AiLimitExceeded, build_ai_client

#: Потолок ответа. Восемь шагов по строке — это сотни токенов, а не тысячи;
#: длинный текст здесь означал бы, что модель ушла рассказывать о пользе блюда.
MAX_TOKENS = 900

#: Сколько ждём. Ручка синхронная: администратор стоит у формы рецепта.
TIMEOUT_S = 40.0

#: Лекарственные формы. В карточке блюда им места нет вовсе, и это единственное
#: правило, которого нет у сводки: там «таблетка» может оказаться пересказом
#: отметки о приёме, а здесь — только указанием, что положить в еду.
#:
#: Единиц дозы (мг, мкг) в списке нет намеренно: правило помощника, отвергающее
#: любое «число + единица», для рецепта непригодно — миллилитры в нём законны.
MEDICATION_FORMS: tuple[str, ...] = (
    "таблетк",
    "капсул",
    "ампул",
    "инъекц",
    "суспензи",
    "сироп",
    "порошок для приема",
)


@dataclass(frozen=True, slots=True)
class Draft:
    instructions: str
    checks: list[dict[str, Any]] = field(default_factory=list)
    ai_job_id: uuid.UUID | None = None


@lru_cache(maxsize=1)
def prompt() -> str:
    """Системный промпт — файлом (раздел 10.4 ТЗ), меняется отдельным PR."""

    return (Path(__file__).parent / "prompts" / "content_draft.md").read_text(encoding="utf-8")


async def draft_recipe(
    client: AiClient,
    *,
    requested_by: uuid.UUID,
    payload: dict[str, Any],
) -> Draft:
    """Способ приготовления по готовому составу."""

    reply = await client.ask(
        kind=AiJobKind.CONTENT_DRAFT,
        requested_by=requested_by,
        # Рецепт не про конкретного ребёнка: он лежит в общей библиотеке.
        patient_id=None,
        system=prompt(),
        payload=payload,
        max_tokens=MAX_TOKENS,
        timeout_s=TIMEOUT_S,
    )

    checks = [finding.as_dict() for finding in sguard.check(reply.text, require_sections=False)]

    medication = find_any(normalize(reply.text), MEDICATION_FORMS)
    if medication is not None:
        checks.append(
            {
                "kind": "medication",
                "rule": "medication_form",
                "fragment": "",
                "matched": medication,
                "hard": True,
            }
        )

    for item in grounding.check(reply.text, payload, only_masses=True):
        household = bool(item.measure)
        checks.append(
            {
                "kind": "household_measure" if household else "ungrounded_number",
                "rule": "household" if household else "not_in_payload",
                "fragment": item.fragment,
                "matched": item.measure if household else _format(item.value),
                # Бытовая мера — жёсткая находка: в составе её нет по построению,
                # значит величина придумана, а «две столовые ложки» читаются как
                # обычный кулинарный текст и проходят мимо глаза.
                "hard": household,
            }
        )
    return Draft(instructions=reply.text.strip(), checks=checks, ai_job_id=reply.job_id)


def _format(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


async def content_draft(
    ctx: dict[str, object],
    requested_by: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Задача ARQ. Ручка `POST /ai/recipe-draft` ждёт её ответа синхронно.

    Как и разбор еды, отвечает конвертом со статусом, а не исключением: ручка
    переводит его в код ответа, и «сегодня хватит» отличается от «модель
    недоступна» ещё до того, как ответ дойдёт до экрана.
    """

    try:
        draft = await draft_recipe(
            build_ai_client(), requested_by=uuid.UUID(requested_by), payload=payload
        )
    except AiLimitExceeded as error:
        return {"status": "limited", "message": str(error)}
    except AiError:
        return {"status": "unavailable"}

    return {
        "status": "ok",
        "instructions": draft.instructions,
        "checks": draft.checks,
        "ai_job_id": str(draft.ai_job_id) if draft.ai_job_id else None,
    }
