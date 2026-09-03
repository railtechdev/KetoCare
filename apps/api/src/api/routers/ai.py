"""`/ai` — разбор свободного текста (раздел 5.3 ТЗ, раздел 10.3, п. 19 этапа 4).

Ручка ждёт ответа синхронно: родитель пишет «Аня съела 30 г масла» и стоит с
телефоном в руке — поллинг здесь был бы решением задачи, которой нет. Разбор
выполняет воркер (`parse_free_text`), таймаут — 15 секунд (раздел 10.1 ТЗ).

**Ничего не сохраняется.** Ответ — черновик: он показывается человеку, и запись
в дневник появляется только после «Подтвердить», отдельным запросом
`POST /patients/{id}/logs/meals` с `ai_job_id` (правило 6 `CLAUDE.md`).

Доступ к ребёнку проверяется здесь, а не в воркере: у задачи нет ни токена, ни
контекста запроса. Пациент передаётся телом — так же, как в `/calc` (раздел 6.3).
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from ..deps.auth import CurrentUserDep, SessionDep, assert_patient_access
from ..errors import ApiError, ErrorCode
from ..ratelimit import AI_RATE_LIMIT, limiter
from ..services import queue as queue_service

router = APIRouter(prefix="/ai", tags=["ai"])

#: Сколько ждём разбор. Раздел 10.1 ТЗ: ручка ждёт синхронно, таймаут 15 с.
PARSE_TIMEOUT_S = 15.0


class ParseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_id: uuid.UUID
    #: Фраза родителя. Верхняя граница — не про модель, а про стоимость: длинный
    #: текст оплачивается токенами, а дневник питания пишется короткими записями.
    text: Annotated[str, Field(min_length=2, max_length=1000)]


class ParsedItem(BaseModel):
    product_id: uuid.UUID
    grams: float
    #: Насколько модель уверена в граммовке: «два яйца» — оценка, и человек
    #: должен видеть, что её надо проверить.
    confidence: float
    #: Название из справочника. Без него подтверждение — это «3f2a1c9d… 30 г»:
    #: проверить такое нельзя, а неподтверждённое подтверждение хуже, чем его
    #: отсутствие.
    name_ru: str | None = None


class ParsedMeal(BaseModel):
    items: list[ParsedItem] = []
    unmatched: list[str] = []


class ParsedSeizure(BaseModel):
    type_hint: str | None = None
    duration_sec: int | None = None
    count: int | None = None


class ParseResponse(BaseModel):
    """Выход раздела 10.3 ТЗ плюс ссылка на строку журнала.

    `ai_job_id` нужен для подтверждения: запись создаётся по нему, а не по
    структуре из ответа — иначе клиент прислал бы под видом разбора что угодно.
    """

    ai_job_id: uuid.UUID
    kind: Literal["meal", "seizure", "other"]
    meal: ParsedMeal | None = None
    seizure: ParsedSeizure | None = None
    clarification_needed: str | None = None


@router.post("/parse", response_model=ParseResponse, summary="Разобрать свободный текст")
@limiter.limit(AI_RATE_LIMIT)
async def parse_text(
    request: Request,
    payload: ParseRequest,
    session: SessionDep,
    user: CurrentUserDep,
) -> ParseResponse:
    await assert_patient_access(session, user, payload.patient_id)

    # Соединение с БД возвращается в пул ДО ожидания разбора. Дальше база не
    # нужна, а ждём мы до 15 секунд: с открытой сессией пятнадцать
    # одновременных разборов заняли бы весь пул (5 + 10 overflow), и вставал бы
    # не разбор, а весь API — вход, дневники, приём у врача. Сессия закрыта, но
    # зависимость закроет её ещё раз при выходе; повторный close безопасен.
    await session.close()

    try:
        answer = await queue_service.run(
            "parse_free_text",
            str(user.id),
            str(payload.patient_id),
            payload.text,
            timeout_s=PARSE_TIMEOUT_S,
        )
    except queue_service.TaskTimeout as error:
        # Не «внутренняя ошибка»: разбор просто не успел. Бот на это предлагает
        # выбрать блюдо из меню, кабинет — записать текстом (раздел 10.2 ТЗ).
        raise _unavailable(
            "Разбор не успел ответить. Попробуйте ещё раз или запишите вручную."
        ) from error
    except queue_service.TaskLost as error:
        raise _unavailable("Разбор сейчас недоступен. Попробуйте позже.") from error

    return _response(answer)


def _response(answer: Any) -> ParseResponse:
    if not isinstance(answer, dict):
        raise _unavailable("Разбор вернул неожиданный ответ.")

    status = answer.get("status")
    if status == "limited":
        # Предел пользователя или дневной бюджет проекта (раздел 10.2 ТЗ).
        raise ApiError(ErrorCode.RATE_LIMITED, str(answer.get("message") or "Лимит исчерпан."))
    if status != "ok":
        raise _unavailable(str(answer.get("message") or "Разбор сейчас недоступен."))

    result = answer.get("result") or {}
    return ParseResponse(ai_job_id=uuid.UUID(str(answer["ai_job_id"])), **result)


def _unavailable(message: str) -> ApiError:
    """Мягкая деградация раздела 10.2 ТЗ.

    Код остаётся из списка раздела 5.1 (новые заводятся только через ADR), а
    состояние передаётся статусом 503: клиенту важно отличить «сломалось
    навсегда» от «сейчас не получится» — от этого зависит, предлагать ли ему
    повтор.
    """

    return ApiError(ErrorCode.INTERNAL, message, status_code=503)
