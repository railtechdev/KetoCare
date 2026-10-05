"""Логика привязки Telegram (ADR-0009).

В роутере остаются только параметры и коды ответов; проверки секрета и сборка
токена — здесь.
"""

from __future__ import annotations

import hmac
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from core import languages
from core.config import get_settings
from core.models import TelegramAccount
from core.models.enums import UserRole
from core.repositories import access as access_repo
from core.repositories import audit as audit_repo
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo
from core.repositories import users as users_repo

from ..errors import ApiError, ErrorCode
from ..schemas_telegram import BotSession, MiniAppChild, MiniAppSession
from ..security import ACCESS_TOKEN_TTL, TokenType, create_token
from . import languages as languages_service
from .telegram_initdata import InitDataError, parse_init_data


def build_deep_link(code: str) -> str | None:
    """`https://t.me/<бот>?start=<код>` — ссылка, которую родитель нажимает с телефона.

    Без настроенного `BOT_USERNAME` возвращает None: показать ссылку на
    несуществующего бота хуже, чем показать один только код.
    """

    username = get_settings().bot_username.lstrip("@")
    if not username:
        return None
    return f"https://t.me/{username}?start={code}"


_NOT_LINKED = (
    "Этот Telegram не привязан ни к одному ребёнку. "
    "Пришлите боту код доступа от врача или родителя ребёнка."
)
_CHILD_NOT_LINKED = "Этот ребёнок не подключён к вашему Telegram."


async def _openable_links(session: AsyncSession, chat_id: int) -> list[TelegramAccount]:
    """Живые привязки чата, по которым действительно можно открыть сессию.

    Привязка к отключённой учётной записи или к записи, ставшей сотрудником,
    сессии не даёт (та же страховка от эскалации, что и у бота), и в
    переключатель детей она не попадает: показать ребёнка, которого нельзя
    открыть, значит пообещать отказ.
    """

    openable: list[TelegramAccount] = []
    for link in await telegram_repo.list_active_links_by_chat(session, chat_id):
        parent = await users_repo.get(session, link.parent_id)
        if parent is None or not parent.is_active or parent.role is not UserRole.PARENT:
            continue
        # Связь взрослого с ребёнком проверяется явно, как в `_rebind`, а не
        # выводится из живой привязки: сегодня каждый путь отзыва доступа гасит
        # и привязки, но новый путь, забывший об этом, иначе открывал бы
        # отрезанному взрослому ребёнка из переключателя (ревью ADR-0048).
        if not await access_repo.user_has_patient_access(
            session, user_id=parent.id, role=parent.role, patient_id=link.patient_id
        ):
            continue
        openable.append(link)
    return openable


async def _children(session: AsyncSession, links: list[TelegramAccount]) -> list[MiniAppChild]:
    children: list[MiniAppChild] = []
    for link in links:
        patient = await patients_repo.get(session, link.patient_id)
        if patient is not None:
            children.append(MiniAppChild(patient_id=patient.id, name=patient.full_name))
    return children


async def _miniapp_session_for(
    session: AsyncSession,
    *,
    link: TelegramAccount,
    links: list[TelegramAccount],
    action: str,
    ip: str | None,
    telegram_language: str | None = None,
) -> MiniAppSession:
    """Пара токенов, суженная до ребёнка ОДНОЙ привязки, и список детей чата.

    Токен несёт `binding_id` этой привязки: отзыв её гасит именно эту сессию, а
    сессии других детей того же чата живут дальше (ADR-0048).
    """

    parent = await users_repo.get(session, link.parent_id)
    if parent is None or not parent.is_active or parent.role is not UserRole.PARENT:
        # Та же страховка от эскалации, что и у бота: привязка не должна
        # открывать права сотрудника, даже если `parent_id` когда-нибудь на
        # него укажет.
        raise ApiError(ErrorCode.UNAUTHORIZED, "Учётная запись недоступна.")

    patient = await patients_repo.get(session, link.patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Ребёнок не найден.")

    def token(token_type: TokenType) -> str:
        return create_token(
            user_id=parent.id,
            role=UserRole.PARENT,
            token_type=token_type,
            patient_scope=link.patient_id,
            password_changed_at=parent.password_changed_at,
            channel="miniapp",
            binding_id=link.id,
        )

    # Вход — событие учётной записи (правило 7): по журналу видно, что сессия
    # ребёнка открыта из Telegram, а не паролем в кабинете, и к какому ребёнку.
    await audit_repo.write_audit_log(
        session,
        user_id=parent.id,
        action=action,
        entity="telegram_accounts",
        entity_id=link.id,
        ip=ip,
        after={"patient_id": str(link.patient_id)},
    )

    return MiniAppSession(
        access_token=token("access"),
        refresh_token=token("refresh"),
        expires_in=int(ACCESS_TOKEN_TTL.total_seconds()),
        patient_id=link.patient_id,
        patient_name=patient.full_name,
        children=await _children(session, links),
        web_url=get_settings().web_origin.rstrip("/"),
        has_web_credentials=parent.has_web_credentials,
        # Язык Telegram — только как умолчание для того, кто ещё не выбирал
        # (ADR-0052); переключение ребёнка подписи не несёт и берёт сохранённый.
        language=await languages_service.adopt_default(
            session,
            parent,
            languages.from_telegram(telegram_language) if telegram_language else None,
        ),
    )


def _pick(links: list[TelegramAccount], patient_id: uuid.UUID) -> TelegramAccount:
    for link in links:
        if link.patient_id == patient_id:
            return link
    raise ApiError(ErrorCode.NOT_FOUND, _CHILD_NOT_LINKED, details={"reason": "child_not_linked"})


async def issue_miniapp_session(
    session: AsyncSession,
    *,
    init_data: str,
    ip: str | None,
    patient_id: uuid.UUID | None = None,
) -> MiniAppSession:
    """Меняет подписанную строку запуска на сессию родителя, суженную до ребёнка.

    Личность подтверждает Telegram своей подписью, а право на ребёнка — живая
    привязка чата: Mini App не заводит третьего способа доступа, он показывает
    то же, к чему семья уже привязала чат (раздел 9 ТЗ).

    Чат ищется по идентификатору пользователя Telegram: привязка рождается в
    личной переписке с ботом, где `chat_id` и есть идентификатор пользователя.
    В группе бот привязку не заводит вовсе, так что второго случая нет.

    Чат может вести нескольких детей (ADR-0048). Открывается названный
    (`patient_id`) или первый привязанный; сессия всё равно одна на ребёнка, а
    остальные дети приходят списком для переключателя.
    """

    settings = get_settings()

    try:
        parsed = parse_init_data(init_data, bot_token=settings.bot_token)
    except InitDataError as exc:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Telegram не подтвердил запуск.") from exc

    links = await _openable_links(session, parsed.user_id)
    if not links:
        # Отдельный код, а не «недостаточно прав»: приложению нужно показать
        # инструкцию по привязке, а не сообщение об отказе (раздел 9 ТЗ).
        raise ApiError(ErrorCode.NOT_FOUND, _NOT_LINKED)

    link = links[0] if patient_id is None else _pick(links, patient_id)
    return await _miniapp_session_for(
        session,
        link=link,
        links=links,
        action="login_miniapp",
        ip=ip,
        telegram_language=parsed.language_code,
    )


async def switch_miniapp_child(
    session: AsyncSession,
    *,
    binding_id: uuid.UUID,
    patient_id: uuid.UUID,
    ip: str | None,
) -> MiniAppSession:
    """Новая сессия Mini App для другого ребёнка того же чата (ADR-0048).

    Опора — привязка, по которой открыта текущая сессия (её живость уже
    проверила `get_current_user`): другой ребёнок ищется среди живых привязок
    ЭТОГО чата, и только там. Подпись Telegram здесь не нужна — она живёт час,
    а семья переключает ребёнка и через два; доказательство того же уровня
    уже есть: текущую сессию открыла подпись этого же чата.

    Старая сессия при этом не отзывается: токены живут в памяти вкладки и
    заменяются новыми, а каждый токен сужен до своего ребёнка — данные другого
    ребёнка старым токеном не прочитать.
    """

    current = await telegram_repo.get_active_link(session, binding_id)
    if current is None:
        raise ApiError(ErrorCode.UNAUTHORIZED, "Привязка отозвана, войдите заново.")

    links = await _openable_links(session, current.chat_id)
    link = _pick(links, patient_id)
    return await _miniapp_session_for(
        session, link=link, links=links, action="miniapp_switch_child", ip=ip
    )


async def issue_bot_session(
    session: AsyncSession, *, link_id: uuid.UUID, secret: str
) -> BotSession:
    """Меняет секрет привязки на access-токен, суженный до её пациента.

    Все отказы отвечают одинаково: по ответу нельзя отличить «нет такой
    привязки» от «неверный секрет» и от «привязка отозвана» — иначе перебор
    `link_id` показывал бы, какие привязки существуют.
    """

    denied = ApiError(ErrorCode.UNAUTHORIZED, "Привязка недействительна.")

    link = await telegram_repo.get_active_link(session, link_id)
    if link is None:
        raise denied

    # compare_digest по хешам: длина одинакова, а сравнение самих секретов
    # выдавало бы длину общего префикса временем ответа.
    if not hmac.compare_digest(telegram_repo.hash_secret(secret), link.secret_hash):
        raise denied

    parent = await users_repo.get(session, link.parent_id)
    if parent is None or not parent.is_active:
        raise denied
    if parent.role is not UserRole.PARENT:
        # Страховка от эскалации: если `parent_id` когда-нибудь укажет на
        # сотрудника, бот не должен получить его права.
        raise denied

    token = create_token(
        user_id=parent.id,
        role=UserRole.PARENT,
        token_type="access",
        patient_scope=link.patient_id,
        password_changed_at=parent.password_changed_at,
        channel="bot",
        binding_id=link.id,
    )
    return BotSession(
        access_token=token,
        expires_in=int(ACCESS_TOKEN_TTL.total_seconds()),
        patient_id=link.patient_id,
    )
