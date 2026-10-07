"""Задача ARQ `notify_family` (раздел 5.4 ТЗ).

Врач меняет назначение — семья должна узнать об этом сегодня, а не когда
в следующий раз откроет приложение. Кетосоотношение и калорийность определяют
каждый приём пищи: сутки готовки по старому назначению — это сутки не той
терапии.

Текст не называет чисел. Соблазн назвать их был — «назначение изменилось»
заставляет открыть приложение, чтобы понять, изменилось ли важное, — но раздел 7.5
ТЗ запрещает боту показывать параметры назначения, а раздел 5.4 задаёт саму
формулировку. Причина не в формальности: чат мог быть привязан к групповому, и
кетосоотношение с калорийностью ушли бы всем его участникам.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

import httpx
import structlog

from core.config import Settings
from core.db import get_sessionmaker
from core.repositories import telegram as telegram_repo

from . import texts
from .children import chat_languages, child_names, named, parent_language
from .telegram import TelegramSendError, send_message

logger = structlog.get_logger(__name__)


async def notify_family(ctx: dict[str, Any], patient_id: str) -> int:
    """Сообщить семье о новом назначении. Возвращает число доставленных чатов."""

    settings = Settings()  # type: ignore[call-arg]
    if not settings.bot_token:
        # Установка без бота. Не сбой: назначение уже сохранено, а канала
        # доставки просто нет.
        return 0

    sessionmaker = get_sessionmaker()
    delivered = 0

    async with sessionmaker() as session, httpx.AsyncClient(timeout=10.0) as client:
        links = await telegram_repo.list_links_for_patient(session, uuid.UUID(patient_id))
        names = await child_names(
            session, patient_id=uuid.UUID(patient_id), chat_ids=live_chats(links)
        )
        languages = await chat_languages(session, links)
        for link in links:
            if link.revoked_at is not None:
                continue
            try:
                await send_message(
                    client,
                    token=settings.bot_token,
                    chat_id=link.chat_id,
                    text=named(
                        texts.text(languages.get(link.chat_id), "prescription_changed"),
                        names.get(link.chat_id),
                    ),
                )
            except TelegramSendError as exc:
                # Один заблокированный чат не отменяет уведомление остальным:
                # у ребёнка может быть привязано несколько.
                logger.warning(
                    "prescription_notice_not_delivered",
                    patient_id=patient_id,
                    reason=str(exc),
                )
                continue
            delivered += 1

    return delivered


#: Текст уведомления (раздел 5.4 ТЗ — формулировка оттуда).
#:
#: Ни цифр, ни ФИО: параметры назначения бот не показывает (раздел 7.5). Имя
#: ребёнка — только в чате, который ведёт нескольких детей, и только имя
#: (`children.named`, ADR-0048).
#:
#: Отправляет в приложение, а не в кабинет: у большинства взрослых из Telegram
#: кабинета нет вовсе, а план дня на сегодня и завтра собирается прямо в
#: приложении (ADR-0041). Цели нового назначения приложение показывает рядом с
#: итогами дня — там их и можно увидеть, не в чате.
NOTICE = texts.RU["prescription_changed"]


async def notify_family_joined(
    ctx: dict[str, Any],
    patient_id: str,
    newcomer_id: str,
    newcomer_name: str,
    inviter_name: str | None,
) -> int:
    """Сообщить остальным взрослым, что к ребёнку подключился новый (ADR-0043).

    Доступ к данным ребёнка не должен появляться тихо: если код ушёл не тому
    человеку, первой это заметит семья. Самому новичку не пишем — он только что
    вошёл и знает об этом. Возвращает число доставленных чатов.
    """

    settings = Settings()  # type: ignore[call-arg]
    if not settings.bot_token:
        return 0

    sessionmaker = get_sessionmaker()
    delivered = 0

    async with sessionmaker() as session, httpx.AsyncClient(timeout=10.0) as client:
        links = await telegram_repo.list_links_for_patient(session, uuid.UUID(patient_id))
        recipients = joined_recipients(links, newcomer_id=uuid.UUID(newcomer_id))
        names = await child_names(session, patient_id=uuid.UUID(patient_id), chat_ids=recipients)
        languages = await chat_languages(session, links)
        for chat_id in recipients:
            text = joined_notice(
                newcomer_name=newcomer_name,
                inviter_name=inviter_name,
                language=languages.get(chat_id),
            )
            try:
                await send_message(
                    client,
                    token=settings.bot_token,
                    chat_id=chat_id,
                    text=named(text, names.get(chat_id)),
                )
            except TelegramSendError as exc:
                logger.warning(
                    "family_joined_notice_not_delivered", patient_id=patient_id, reason=str(exc)
                )
                continue
            delivered += 1

    return delivered


def joined_recipients(links: list[Any], *, newcomer_id: uuid.UUID) -> list[int]:
    """Живые чаты ребёнка, кроме чатов самого новичка, — без повторов."""

    seen: list[int] = []
    for link in links:
        if link.revoked_at is not None or link.parent_id == newcomer_id:
            continue
        if link.chat_id not in seen:
            seen.append(link.chat_id)
    return seen


def joined_notice(
    *, newcomer_name: str, inviter_name: str | None, language: str | None = None
) -> str:
    """Текст уведомления о новом близком.

    Имена взрослых — да; имя ребёнка — только в чате нескольких детей, его
    ставит `children.named` над текстом (ADR-0048).
    Последняя фраза — следующий шаг, а не тревога: в подавляющем большинстве
    случаев новичка позвал кто-то из своих, и сообщение это подтверждает.
    """

    by = texts.text(language, "joined_by", inviter=inviter_name) if inviter_name else ""
    return texts.text(language, "joined", newcomer=newcomer_name, by=by)


async def notify_family_nudge(
    ctx: dict[str, Any],
    patient_id: str,
    specialist_name: str,
    specialist_role: str,
) -> int:
    """Специалист просит семью отметить дневник (ADR-0046).

    Получают все живые чаты ребёнка — без повторов: у ребёнка может быть
    несколько взрослых с Telegram, и просьба обращена к семье, а не к одному из
    них. Возвращает число доставленных чатов.
    """

    settings = Settings()  # type: ignore[call-arg]
    if not settings.bot_token:
        return 0

    sessionmaker = get_sessionmaker()
    delivered = 0

    async with sessionmaker() as session, httpx.AsyncClient(timeout=10.0) as client:
        links = await telegram_repo.list_links_for_patient(session, uuid.UUID(patient_id))
        recipients = nudge_recipients(links)
        names = await child_names(session, patient_id=uuid.UUID(patient_id), chat_ids=recipients)
        languages = await chat_languages(session, links)
        for chat_id in recipients:
            text = nudge_notice(
                specialist_name=specialist_name,
                specialist_role=specialist_role,
                language=languages.get(chat_id),
            )
            try:
                await send_message(
                    client,
                    token=settings.bot_token,
                    chat_id=chat_id,
                    text=named(text, names.get(chat_id)),
                )
            except TelegramSendError as exc:
                logger.warning("family_nudge_not_delivered", patient_id=patient_id, reason=str(exc))
                continue
            delivered += 1

    return delivered


def nudge_recipients(links: list[Any]) -> list[int]:
    """Живые чаты ребёнка без повторов."""

    seen: list[int] = []
    for link in links:
        if link.revoked_at is None and link.chat_id not in seen:
            seen.append(link.chat_id)
    return seen


#: Роль специалиста словами — так, как семья его знает (ключ каталога).
_ROLE_WORDS = {"doctor": "role_doctor", "dietitian": "role_dietitian"}


def nudge_notice(*, specialist_name: str, specialist_role: str, language: str | None = None) -> str:
    """Текст просьбы.

    Нейтральный намеренно (аудит блокеров, C5): кто просит, о чём и где это
    сделать. Ни чисел, ни имени ребёнка, ни слова о том, что делать с ребёнком:
    параметры назначения бот не показывает (раздел 7.5 ТЗ), а любой совет
    семье — медицинский текст, и пишет его клиника. Кнопку «Приложение» текст
    не обещает: её нет, пока Mini App не выложен. Незнакомая роль даёт
    «Специалист», а не пустое место.
    """

    role = texts.text(language, _ROLE_WORDS.get(specialist_role, "role_other"))
    return texts.text(language, "nudge", role=role, name=specialist_name)


async def notify_family_menu_composed(
    ctx: dict[str, Any],
    patient_id: str,
    menu_date: str,
    composer_name: str,
    composer_role: str,
) -> int:
    """Сообщить семье, что план дня составил специалист (ADR-0047).

    План, по которому кормят ребёнка, поменял не тот, кто его готовит, — и семья
    должна узнать это до готовки, а не у плиты. Возвращает число доставленных
    чатов.
    """

    settings = Settings()  # type: ignore[call-arg]
    if not settings.bot_token:
        return 0

    sessionmaker = get_sessionmaker()
    delivered = 0

    async with sessionmaker() as session, httpx.AsyncClient(timeout=10.0) as client:
        links = await telegram_repo.list_links_for_patient(session, uuid.UUID(patient_id))
        recipients = live_chats(links)
        names = await child_names(session, patient_id=uuid.UUID(patient_id), chat_ids=recipients)
        languages = await chat_languages(session, links)
        for chat_id in recipients:
            text = menu_composed_notice(
                composer_name=composer_name,
                composer_role=composer_role,
                menu_date=date.fromisoformat(menu_date),
                language=languages.get(chat_id),
            )
            try:
                await send_message(
                    client,
                    token=settings.bot_token,
                    chat_id=chat_id,
                    text=named(text, names.get(chat_id)),
                )
            except TelegramSendError as exc:
                logger.warning(
                    "menu_composed_notice_not_delivered", patient_id=patient_id, reason=str(exc)
                )
                continue
            delivered += 1

    return delivered


def live_chats(links: list[Any]) -> list[int]:
    """Неотозванные чаты ребёнка — без повторов (два взрослых в одной группе)."""

    seen: list[int] = []
    for link in links:
        if link.revoked_at is None and link.chat_id not in seen:
            seen.append(link.chat_id)
    return seen


#: Как специалист назван в сообщении. Неизвестная роль — нейтральное слово, а
#: не догадка: сообщение уходит семье, и «врач» вместо «диетолога» — неправда.
_ROLE_WORDS_LOWER = {"doctor": "role_doctor_lower", "dietitian": "role_dietitian_lower"}


def menu_composed_notice(
    *, composer_name: str, composer_role: str, menu_date: date, language: str | None = None
) -> str:
    """Текст уведомления о плане от специалиста.

    Имя взрослого — да (решение заказчика G6), имя ребёнка — нет, и ни граммов,
    ни соотношения (раздел 7.5 ТЗ): чат мог быть групповым. Последняя фраза —
    где смотреть, потому что сам план бот не показывает.
    """

    role = texts.text(language, _ROLE_WORDS_LOWER.get(composer_role, "role_other_lower"))
    return texts.text(
        language,
        "menu_composed",
        name=composer_name,
        role=role,
        date=menu_date.strftime("%d.%m"),
    )


#: Сообщение владельцу о смене пароля кабинета из Telegram (аудит, E3).
#: Следующий шаг назван: если это был не он — новый код и врач.
PASSWORD_CHANGED_NOTICE = texts.RU["password_changed"]


async def notify_password_changed(ctx: dict[str, Any], parent_id: str) -> int:
    """Сообщить во все чаты взрослого, что пароль кабинета изменён."""

    settings = Settings()  # type: ignore[call-arg]
    if not settings.bot_token:
        return 0

    sessionmaker = get_sessionmaker()
    delivered = 0
    async with sessionmaker() as session, httpx.AsyncClient(timeout=10.0) as client:
        links = await telegram_repo.list_live_links_for_parent(session, uuid.UUID(parent_id))
        # Сообщение адресовано самому взрослому — и на его языке (ADR-0052).
        text = texts.text(await parent_language(session, uuid.UUID(parent_id)), "password_changed")
        for chat_id in sorted({link.chat_id for link in links}):
            try:
                await send_message(client, token=settings.bot_token, chat_id=chat_id, text=text)
            except TelegramSendError as exc:
                logger.warning("password_changed_notice_not_delivered", reason=str(exc))
                continue
            delivered += 1
    return delivered


#: События учётной записи, о которых узнают все её чаты (находки Н2 и Н7).
#: Ключ — имя события в очереди и ключ текста; неизвестное событие не
#: отправляется — сообщение о безопасности со случайным текстом хуже молчания.
ACCOUNT_SECURITY_EVENTS = frozenset({"device_linked", "web_credentials_set"})


async def notify_account_security(
    ctx: dict[str, Any], parent_id: str, event: str, skip_chat_id: int | None = None
) -> int:
    """Сообщить во все чаты взрослого о событии его учётной записи.

    `skip_chat_id` — чат, который и вызвал событие: новому устройству бот уже
    ответил, а предупреждение предназначено владельцу на прежних.
    Текст постоянный — без имён, чисел и ссылок: он уходит и туда, где чат
    могли увидеть посторонние.
    """

    if event not in ACCOUNT_SECURITY_EVENTS:
        logger.warning("account_security_event_unknown", kind=event)
        return 0
    settings = Settings()  # type: ignore[call-arg]
    if not settings.bot_token:
        return 0

    sessionmaker = get_sessionmaker()
    delivered = 0
    async with sessionmaker() as session, httpx.AsyncClient(timeout=10.0) as client:
        links = await telegram_repo.list_live_links_for_parent(session, uuid.UUID(parent_id))
        text = texts.text(await parent_language(session, uuid.UUID(parent_id)), event)
        for chat_id in sorted({link.chat_id for link in links} - {skip_chat_id}):
            try:
                await send_message(client, token=settings.bot_token, chat_id=chat_id, text=text)
            except TelegramSendError as exc:
                logger.warning("account_security_notice_not_delivered", kind=event, reason=str(exc))
                continue
            delivered += 1
    return delivered
