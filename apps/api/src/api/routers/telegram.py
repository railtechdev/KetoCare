"""Привязка Telegram-чата к ребёнку (раздел 7.1 ТЗ, [ADR-0009](../../../../../docs/adr/0009-telegram-bot-authentication.md), [ADR-0040](../../../../../docs/adr/0040-patient-record-before-family-account.md)).

Три шага и три разных субъекта:

1. Код доступа выпускает врач в карте ребёнка или сам родитель в кабинете:
   `POST /patients/{patient_id}/access-codes` (роутер `access_codes.py`).
2. Бот, получив `/start <код>`, гасит его: `POST /auth/access-codes/activate-telegram`.
   Сервисный токен. В ответ — секрет привязки, который бот сохраняет у себя.
   Учётная запись родителя при этом может и родиться: почты и пароля у него нет.
3. Перед работой с данными бот меняет секрет на сессию: `POST /auth/bot/session`.
   Сервисный токен **и** секрет. В ответ — access-токен на 15 минут, суженный до
   одного ребёнка.

**Кода привязки (`link_codes`) больше нет.** Видов кода было два: один понимал
бот, другой выдавал врач — и семья, пришедшая с приёма с кодом врача, получала в
боте «код недействителен». Вид кода теперь один, а разницу в сроке жизни (неделя
у специалиста, четверть часа у родителя) держит `ttl_for(role)`.

Отвязка — `POST /patients/{patient_id}/telegram/{link_id}/revoke`, родителем
из кабинета. Раздел 5.3 ТЗ ручку отвязки не перечисляет, но поле `revoked_at` в
схеме есть, а правило 7 требует аудита «привязки/**отвязки** Telegram»: отзыв
предусмотрен, просто не выписан. Без него привязку нечем снять, если телефон
потерян.
"""

from __future__ import annotations

import uuid
from datetime import time
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request

from core.config import get_settings
from core.repositories import audit as audit_repo
from core.repositories import reminders as reminders_repo
from core.repositories import telegram as telegram_repo

from ..client_address import client_address
from ..deps.auth import PatientAccessDep, SessionDep
from ..deps.bot import verify_bot_service_token
from ..errors import ApiError, ErrorCode
from ..ratelimit import BOT_RATE_LIMIT, limiter
from ..schemas import ReminderSettingsRead, ReminderSettingsWrite
from ..schemas_access import AccessCodeTelegramActivate
from ..schemas_telegram import (
    BotSession,
    BotSessionRequest,
    LinkVerified,
    TelegramLinkRead,
)
from ..services import access_codes as access_codes_service
from ..services import telegram as telegram_service

router = APIRouter(prefix="/patients/{patient_id}", tags=["telegram"])
bot_router = APIRouter(prefix="/auth", tags=["telegram"])

PatientIdPath = Annotated[uuid.UUID, Path()]


@router.get(
    "/reminders",
    response_model=ReminderSettingsRead,
    summary="Настройки напоминаний ребёнка",
)
async def get_reminders(
    patient_id: PatientIdPath, session: SessionDep, user: PatientAccessDep
) -> ReminderSettingsRead:
    """Настройки или значения по умолчанию.

    Строка заводится при первой правке, а не при заведении ребёнка: сохранять
    её заранее значит хранить строку, ничем не отличающуюся от умолчаний, и
    однажды разойтись с ними при смене умолчания.
    """

    settings = await reminders_repo.get(session, patient_id=patient_id)
    if settings is not None:
        return ReminderSettingsRead.model_validate(settings)

    return ReminderSettingsRead(
        patient_id=patient_id,
        enabled=True,
        ketones_at=None,
        weight_at=None,
        medications_at=None,
        # Единственное включённое из коробки — мягкое «за сегодня нет записей»
        # в 20:00 (раздел 7.4 ТЗ).
        no_records_at=time(hour=reminders_repo.DEFAULT_NO_RECORDS_HOUR),
    )


@router.put(
    "/reminders",
    response_model=ReminderSettingsRead,
    summary="Изменить настройки напоминаний",
)
async def update_reminders(
    patient_id: PatientIdPath,
    payload: ReminderSettingsWrite,
    session: SessionDep,
    user: PatientAccessDep,
) -> ReminderSettingsRead:
    """Настройки задаёт тот, кто напоминания получает, — семья.

    Врач их не трогает: время замера дома выбирает семья, а не расписание
    клиники. Доступ проверяется обычной связью с пациентом.
    """

    settings = await reminders_repo.upsert(
        session,
        patient_id=patient_id,
        updated_by=user.id,
        enabled=payload.enabled,
        ketones_at=payload.ketones_at,
        weight_at=payload.weight_at,
        medications_at=payload.medications_at,
        no_records_at=payload.no_records_at,
    )
    return ReminderSettingsRead.model_validate(settings)


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
    "/access-codes/activate-telegram",
    response_model=LinkVerified,
    status_code=201,
    summary="Активировать код доступа (бот)",
    dependencies=[Depends(verify_bot_service_token)],
)
@limiter.limit(BOT_RATE_LIMIT)
async def activate_access_code_from_telegram(
    payload: AccessCodeTelegramActivate, request: Request, session: SessionDep
) -> LinkVerified:
    """Гасит код доступа и создаёт привязку чата — вместе с учётной записью
    родителя, если её ещё нет (ADR-0040, этап Б).

    Пришла на место `POST /auth/link-codes/verify`: коды привязки были вторым
    видом кода, понятным только боту, и семья, получившая код от врача, в боте
    получала отказ. Вид кода теперь один.

    Проверка сервисного токена — зависимостью, а не первой строкой тела: так она
    отрабатывает до разбора тела (иначе кривое тело без токена давало бы 422
    вместо 401) и попадает в OpenAPI, откуда о заголовке узнаёт клиент.

    Ответ намеренно той же формы, что был у погашения кода привязки: боту всё
    равно, чьим кодом пришёл родитель.
    """

    parent, patient, link, secret = await access_codes_service.activate_from_telegram(
        session,
        code=payload.code,
        chat_id=payload.chat_id,
        telegram_user_id=payload.telegram_user_id,
        first_name=payload.first_name,
        last_name=payload.last_name,
        ip=client_address(request),
    )
    return LinkVerified(
        link_id=link.id,
        patient_id=link.patient_id,
        patient_name=patient.full_name,
        secret=secret,
        web_url=get_settings().web_origin.rstrip("/"),
        has_web_credentials=parent.has_web_credentials,
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
