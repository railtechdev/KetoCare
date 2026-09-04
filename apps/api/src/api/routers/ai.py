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

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from core.models.enums import AiConversationChannel, RecipeCategory, UserRole
from core.repositories import ai_conversations as conversations_repo
from core.repositories import products as products_repo
from core.schemas.ai_conversations import new_message

from ..deps.auth import CurrentUserDep, SessionDep, assert_patient_access, require_roles
from ..errors import ApiError, ErrorCode
from ..ratelimit import AI_RATE_LIMIT, limiter
from ..schemas_ai import AssistantAccepted, AssistantAsk
from ..services import queue as queue_service

router = APIRouter(prefix="/ai", tags=["ai"])

#: Сколько ждём разбор. Раздел 10.1 ТЗ: ручка ждёт синхронно, таймаут 15 с.
PARSE_TIMEOUT_S = 15.0

#: Сколько ждём черновик рецепта. Дольше разбора: там одна фраза, здесь восемь
#: шагов у smart-модели. Меньше шестидесяти — на шестидесятой nginx рвёт
#: соединение, и оплаченный ответ терялся бы на границе прокси.
RECIPE_DRAFT_TIMEOUT_S = 45.0


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


@router.post(
    "/assistant/messages",
    response_model=AssistantAccepted,
    status_code=202,
    summary="Спросить помощника",
)
@limiter.limit(AI_RATE_LIMIT)
async def ask_assistant(
    request: Request,
    payload: AssistantAsk,
    session: SessionDep,
    user: CurrentUserDep,
) -> AssistantAccepted:
    """Принять вопрос и поставить ответ в очередь (раздел 10.4 ТЗ).

    202, а не синхронный ответ, как у разбора еды: помощник отвечает секундами,
    а nginx перед API рвёт соединение на шестидесятой — ответ, за который уже
    заплачено, терялся бы на границе прокси. Поэтому в переписку сразу кладётся
    пустое сообщение-ожидание, воркер заменяет его ответом, а экран дочитывает
    переписку (ADR-0022).

    Спрашивает только семья: врач читает переписку, но не ведёт её от имени
    родителя — иначе в карте появились бы вопросы, которых семья не задавала.
    """

    await assert_patient_access(session, user, payload.patient_id)

    if user.role != UserRole.PARENT:
        raise ApiError(ErrorCode.FORBIDDEN, "Помощник отвечает семье, а не специалисту.")

    channel = (
        AiConversationChannel.MINIAPP if user.channel == "miniapp" else AiConversationChannel.WEB
    )

    if payload.conversation_id is None:
        conversation = await conversations_repo.create(
            session, user_id=user.id, patient_id=payload.patient_id, channel=channel
        )
    else:
        existing = await conversations_repo.get_for_update(session, payload.conversation_id)
        # Одно сообщение на три случая — нет, чужой ребёнок, чужой автор: по
        # разнице ответов иначе устанавливается, что разговор существует.
        if (
            existing is None
            or existing.patient_id != payload.patient_id
            or existing.user_id != user.id
        ):
            raise ApiError(ErrorCode.NOT_FOUND, "Разговор не найден.")
        conversation = existing

    question_seq = conversations_repo.next_seq(conversation)
    reply_seq = question_seq + 1
    await conversations_repo.append(
        session,
        conversation=conversation,
        messages=[
            new_message(seq=question_seq, role="user", text=payload.text),
            # Пустое «ожидание» появляется сразу: экран рисует на этом месте
            # «помощник думает», а не пустоту, из которой непонятно, ушёл ли
            # вопрос вообще.
            new_message(seq=reply_seq, role="assistant", status="pending"),
        ],
    )
    conversation_id = conversation.id
    await session.commit()

    await queue_service.enqueue(
        "assistant_reply",
        str(conversation_id),
        str(user.id),
        str(payload.patient_id),
        payload.text,
        reply_seq,
    )

    return AssistantAccepted(
        conversation_id=conversation_id, question_seq=question_seq, reply_seq=reply_seq
    )


class DraftIngredient(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
    grams: Annotated[float, Field(gt=0, le=10_000)]


class RecipeDraftRequest(BaseModel):
    """Готовый состав блюда. Модель его не подбирает и не меняет."""

    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, Field(min_length=2, max_length=255)]
    category: RecipeCategory
    servings: Annotated[int, Field(ge=1, le=50)]
    ingredients: Annotated[list[DraftIngredient], Field(min_length=1, max_length=30)]


class DraftCheck(BaseModel):
    kind: str
    rule: str
    fragment: str
    matched: str
    hard: bool


class RecipeDraftResponse(BaseModel):
    """Черновик способа приготовления. Ничего не сохранено.

    Карточку сохраняет человек обычной формой рецепта — правило 6 CLAUDE.md
    здесь выполняется самой формой работы, отдельного подтверждения не нужно.
    """

    instructions: str
    checks: list[DraftCheck] = []
    ai_job_id: uuid.UUID | None = None


@router.post(
    "/recipe-draft",
    response_model=RecipeDraftResponse,
    summary="Черновик способа приготовления",
    dependencies=[Depends(require_roles(UserRole.ADMIN, UserRole.DIETITIAN))],
)
@limiter.limit(AI_RATE_LIMIT)
async def draft_recipe(
    request: Request,
    payload: RecipeDraftRequest,
    session: SessionDep,
    user: CurrentUserDep,
) -> RecipeDraftResponse:
    """Способ приготовления по готовому составу (раздел 10.1 ТЗ, `content_draft`).

    Синхронно, как разбор еды: диетолог стоит у формы рецепта и ждёт ответа
    сейчас. Ничего не сохраняется — текст возвращается на экран, там его правят
    и сохраняют обычной формой.

    Названия продуктов подставляет сервер по идентификаторам: модель получает
    список, который ей нельзя менять, а неизвестный идентификатор — ошибка
    запроса, а не повод придумать продукт.
    """

    ingredients: list[dict[str, Any]] = []
    for item in payload.ingredients:
        product = await products_repo.get(session, item.product_id)
        if product is None:
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                "В составе есть продукт, которого нет в справочнике.",
                details={"product_id": str(item.product_id)},
            )
        ingredients.append({"name_ru": product.name_ru, "grams": item.grams})

    prompt_payload = {
        "title": payload.title,
        "category": payload.category.value,
        "servings": payload.servings,
        "ingredients": ingredients,
    }

    # Соединение с БД возвращается в пул до ожидания: дальше база не нужна, а
    # ждём мы почти минуту — та же причина, что у разбора еды.
    await session.close()

    try:
        answer = await queue_service.run(
            "content_draft", str(user.id), prompt_payload, timeout_s=RECIPE_DRAFT_TIMEOUT_S
        )
    except queue_service.TaskTimeout as error:
        raise _unavailable(
            "Черновик не успел собраться. Попробуйте ещё раз или напишите шаги сами."
        ) from error
    except queue_service.TaskLost as error:
        raise _unavailable("Черновик сейчас недоступен. Попробуйте позже.") from error

    return _draft_response(answer)


def _draft_response(answer: Any) -> RecipeDraftResponse:
    if not isinstance(answer, dict):
        raise _unavailable("Черновик вернулся в неожиданном виде.")

    status = answer.get("status")
    if status == "limited":
        raise ApiError(ErrorCode.RATE_LIMITED, str(answer.get("message") or "Лимит исчерпан."))
    if status != "ok":
        raise _unavailable(str(answer.get("message") or "Черновик сейчас недоступен."))

    job_id = answer.get("ai_job_id")
    return RecipeDraftResponse(
        instructions=str(answer.get("instructions") or ""),
        checks=[DraftCheck.model_validate(item) for item in answer.get("checks") or []],
        ai_job_id=uuid.UUID(str(job_id)) if job_id else None,
    )


def _unavailable(message: str) -> ApiError:
    """Мягкая деградация раздела 10.2 ТЗ.

    Код остаётся из списка раздела 5.1 (новые заводятся только через ADR), а
    состояние передаётся статусом 503: клиенту важно отличить «сломалось
    навсегда» от «сейчас не получится» — от этого зависит, предлагать ли ему
    повтор.
    """

    return ApiError(ErrorCode.INTERNAL, message, status_code=503)
