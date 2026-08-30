"""Привязка Telegram-чата к ребёнку (раздел 7.1 ТЗ, [ADR-0009](../../../../../docs/adr/0009-telegram-bot-authentication.md)).

Три шага и три разных субъекта:

1. Родитель в кабинете просит код: `POST /patients/{patient_id}/link-codes`.
   Обычная сессия, обычная проверка доступа к ребёнку.
2. Бот, получив `/start <код>`, гасит код: `POST /auth/link-codes/verify`.
   Сервисный токен. В ответ — секрет привязки, который бот сохраняет у себя.
3. Перед работой с данными бот меняет секрет на сессию: `POST /auth/bot/session`.
   Сервисный токен **и** секрет. В ответ — access-токен на 15 минут, суженный до
   одного ребёнка.

Отвязка — `POST /patients/{patient_id}/telegram/{link_id}/revoke`, тоже родителем
из кабинета. Раздел 5.3 ТЗ ручку отвязки не перечисляет, но поле `revoked_at` в
схеме есть, а правило 7 требует аудита «привязки/**отвязки** Telegram»: отзыв
предусмотрен, просто не выписан. Без него привязку нечем снять, если телефон
потерян.

Путь выдачи кода — `POST /patients/{patient_id}/link-codes`, а не `POST
/auth/link-codes` из сводной таблицы 5.3. Так `patient_id` приходит из пути и
ручка проходит через `require_patient_access`, как любая другая ручка с данными
пациента (правило 5). С `patient_id` в теле проверка была бы ручной — то есть
такой, которую можно забыть, и родитель выпустил бы код привязки на чужого
ребёнка.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from sqlalchemy.exc import IntegrityError

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo

from ..client_address import client_address
from ..deps.auth import PatientAccessDep, SessionDep
from ..deps.bot import verify_bot_service_token
from ..errors import ApiError, ErrorCode
from ..ratelimit import BOT_RATE_LIMIT, limiter
from ..schemas_telegram import (
    BotSession,
    BotSessionRequest,
    LinkCodeCreated,
    LinkCodeVerify,
    LinkVerified,
    TelegramLinkRead,
)
from ..services import telegram as telegram_service

router = APIRouter(prefix="/patients/{patient_id}", tags=["telegram"])
bot_router = APIRouter(prefix="/auth", tags=["telegram"])

PatientIdPath = Annotated[uuid.UUID, Path()]


@router.post(
    "/link-codes",
    response_model=LinkCodeCreated,
    status_code=201,
    summary="Выпустить код привязки Telegram",
)
async def create_link_code(
    patient_id: PatientIdPath, request: Request, session: SessionDep, user: PatientAccessDep
) -> LinkCodeCreated:
    if user.role is not UserRole.PARENT:
        # Привязывает бот именно семья: раздел 7 ТЗ описывает бота как канал
        # родителя. Врачу и диетологу он не нужен, а админ к пациенту и так не
        # имеет доступа.
        raise ApiError(ErrorCode.FORBIDDEN, "Код привязки выпускает родитель.")
    if user.channel != "web":
        # Ботовому токену выпуск новых кодов закрыт: иначе временный доступ к
        # одному чату размножался бы в новые привязки.
        raise ApiError(ErrorCode.FORBIDDEN, "Это действие недоступно из Telegram-бота.")

    code = await telegram_repo.create_code(session, parent_id=user.id, patient_id=patient_id)

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="telegram_link_code_issued",
        entity="link_codes",
        entity_id=patient_id,
        ip=client_address(request),
        after={"expires_at": code.expires_at.isoformat()},
    )

    return LinkCodeCreated(
        code=code.code,
        expires_at=code.expires_at,
        deep_link=telegram_service.build_deep_link(code.code),
    )


@router.get(
    "/telegram",
    response_model=list[TelegramLinkRead],
    summary="Привязанные Telegram-чаты ребёнка",
)
async def list_links(
    patient_id: PatientIdPath, session: SessionDep, user: PatientAccessDep
) -> list[TelegramLinkRead]:
    links = await telegram_repo.list_links_for_patient(session, patient_id)
    return [TelegramLinkRead.model_validate(link) for link in links]


@router.post(
    "/telegram/{link_id}/revoke",
    response_model=TelegramLinkRead,
    summary="Отвязать Telegram-чат",
)
async def revoke_link(
    patient_id: PatientIdPath,
    link_id: Annotated[uuid.UUID, Path()],
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> TelegramLinkRead:
    link = await telegram_repo.get_active_link(session, link_id)
    # Принадлежность строки проверяется явно: `require_patient_access` отвечает
    # за пациента из пути, но не за то, что привязка относится именно к нему.
    # Без этой сверки идентификатор чужой привязки снимал бы её у другой семьи.
    if link is None or link.patient_id != patient_id:
        raise ApiError(ErrorCode.NOT_FOUND, "Привязка не найдена.")

    revoked = await telegram_repo.revoke(session, link_id)
    # Между чтением выше и отзывом привязку мог снять параллельный запрос:
    # `revoke` отвечает None, если строка уже не живая.
    if revoked is None or revoked.revoked_at is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Привязка не найдена.")

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="telegram_unlink",
        entity="telegram_accounts",
        entity_id=revoked.id,
        ip=client_address(request),
        before={"chat_id": revoked.chat_id, "revoked_at": None},
        after={"chat_id": revoked.chat_id, "revoked_at": revoked.revoked_at.isoformat()},
    )

    return TelegramLinkRead.model_validate(revoked)


@bot_router.post(
    "/link-codes/verify",
    response_model=LinkVerified,
    summary="Погасить код привязки (бот)",
    dependencies=[Depends(verify_bot_service_token)],
)
@limiter.limit(BOT_RATE_LIMIT)
async def verify_link_code(
    payload: LinkCodeVerify, request: Request, session: SessionDep
) -> LinkVerified:
    """Гасит код и создаёт привязку.

    Проверка сервисного токена — зависимостью, а не первой строкой тела: так она
    отрабатывает до разбора тела (иначе кривое тело без токена давало бы 422
    вместо 401) и попадает в OpenAPI, откуда о заголовке узнаёт клиент.
    """

    # Занятость чата проверяется ДО погашения кода. При обратном порядке чужая
    # привязка сжигала бы код родителя: он получал 409 и должен был просить
    # новый, ничего не сделав неправильно.
    existing = await telegram_repo.get_active_link_by_chat(session, payload.chat_id)
    if existing is not None:
        # Живая привязка чата не перенацеливается: `UPDATE ... WHERE chat_id`
        # это обновление по несекретному ключу, то есть способ увести чужой чат
        # себе. Чат сначала отвязывают из кабинета — там, где видно, чей он.
        raise ApiError(
            ErrorCode.CONFLICT,
            "Этот чат уже привязан. Сначала отвяжите его в кабинете.",
        )

    # Атомарное погашение: два одновременных `/start` с одним кодом дадут
    # привязку ровно одному чату.
    code = await telegram_repo.claim_code(session, payload.code)
    if code is None:
        # Один ответ на «нет такого кода», «истёк» и «уже использован»: иначе
        # восьмисимвольный код можно перебирать, отличая существующие от несуществующих.
        raise ApiError(ErrorCode.NOT_FOUND, "Код привязки недействителен или истёк.")

    patient = await patients_repo.get(session, code.patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пациент не найден.")

    secret = telegram_repo.generate_binding_secret()
    try:
        link = await telegram_repo.create_link(
            session,
            parent_id=code.parent_id,
            patient_id=code.patient_id,
            chat_id=payload.chat_id,
            secret=secret,
        )
    except IntegrityError as exc:
        # Проверка занятости выше и вставка ниже — не одна операция: два
        # одновременных запроса с разными кодами на один чат оба пройдут
        # проверку. Частичный уникальный индекс их разведёт, но без этого
        # перехвата второй получил бы 500 вместо внятного отказа.
        raise ApiError(
            ErrorCode.CONFLICT,
            "Этот чат уже привязан. Сначала отвяжите его в кабинете.",
        ) from exc

    await audit_repo.write_audit_log(
        session,
        user_id=code.parent_id,
        action="telegram_link",
        entity="telegram_accounts",
        entity_id=link.id,
        ip=client_address(request),
        after={"chat_id": link.chat_id, "patient_id": str(link.patient_id)},
    )

    return LinkVerified(
        link_id=link.id,
        patient_id=link.patient_id,
        patient_name=patient.full_name,
        secret=secret,
    )


@bot_router.post(
    "/bot/session",
    response_model=BotSession,
    summary="Обменять секрет привязки на сессию (бот)",
    dependencies=[Depends(verify_bot_service_token)],
)
@limiter.limit(BOT_RATE_LIMIT)
async def create_bot_session(
    payload: BotSessionRequest, request: Request, session: SessionDep
) -> BotSession:
    """Выдаёт access-токен, суженный до ребёнка из привязки.

    Refresh не выдаётся: бот в любой момент повторит обмен. Так временный доступ
    к чату не превращается в тридцатидневную сессию родителя.
    """

    token = await telegram_service.issue_bot_session(
        session, link_id=payload.link_id, secret=payload.secret
    )
    return token
