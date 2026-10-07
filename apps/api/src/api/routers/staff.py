"""`/users` — справочник персонала (ADR-0003).

Нужен для передачи пациента коллеге: чтобы указать врача, его надо выбрать.
Клинических данных здесь нет — идентификатор, имя и роль активных специалистов.
Видят справочник только doctor и dietitian: родителю он не нужен, а
администратор пациентами не распоряжается (раздел 5.1 ТЗ).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request, Response

from core import languages
from core.config import get_settings
from core.models import User
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import telegram as telegram_repo
from core.repositories import users as users_repo

from .. import after_commit, login_throttle
from ..client_address import client_address
from ..cookies import set_auth_cookies
from ..deps.auth import CurrentUserDep, SessionDep, bearer_token, require_roles
from ..errors import ApiError, ErrorCode
from ..ratelimit import AUTH_RATE_LIMIT, limiter
from ..schemas import (
    AccountNotice,
    ColleagueRead,
    CredentialsCreate,
    LanguageRead,
    LanguageUpdate,
    MeUpdate,
    PasswordChange,
    PasswordResetViaTelegram,
    TokenPair,
    UserRead,
)
from ..schemas_access import AccessCodeClaim, AccessCodeClaimed
from ..security import create_token, decode_token, hash_password_async, verify_password_async
from ..services import access_codes as access_codes_service
from ..services.telegram_initdata import InitDataError, parse_init_data

router = APIRouter(prefix="/users", tags=["users"])

CARE_ROLES = (UserRole.DOCTOR, UserRole.DIETITIAN)


@router.get(
    "/colleagues",
    response_model=list[ColleagueRead],
    summary="Врачи и диетологи клиники",
    dependencies=[Depends(require_roles(*CARE_ROLES))],
)
async def list_colleagues(session: SessionDep) -> list[ColleagueRead]:
    users = await users_repo.list_active_by_roles(session, roles=CARE_ROLES)
    return [ColleagueRead.model_validate(u) for u in users]


@router.post(
    "/me/access-codes/activate",
    response_model=AccessCodeClaimed,
    status_code=201,
    summary="Добавить ребёнка по коду от врача",
)
@limiter.limit(AUTH_RATE_LIMIT)
async def activate_access_code_for_me(
    payload: AccessCodeClaim,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> AccessCodeClaimed:
    """Один экран на два случая: второй ребёнок на терапии и второй родитель,
    у которого учётная запись уже есть (ADR-0040).

    Живёт в `/users/me`, а не в карте ребёнка: ребёнка ещё нет в кабинете, и
    `patient_id` для `require_patient_access` взять неоткуда — его приносит сам
    код.
    """

    if user.role is not UserRole.PARENT:
        # Специалист получает доступ к ребёнку через ведение, а не через код
        # семьи: иначе код становился бы способом «взять» чужого пациента.
        raise ApiError(ErrorCode.FORBIDDEN, "Код доступа активирует семья.")
    if user.channel != "web":
        raise ApiError(ErrorCode.FORBIDDEN, "Добавить ребёнка можно только в веб-кабинете.")

    patient = await access_codes_service.activate_for_user(
        session, code=payload.code, parent=user, ip=client_address(request)
    )
    return AccessCodeClaimed(patient_id=patient.id, patient_name=patient.full_name)


@router.get("/me", response_model=UserRead, summary="Свой профиль")
async def read_me(user: CurrentUserDep, session: SessionDep) -> UserRead:
    """Профиль текущего пользователя.

    Отдельная ручка нужна была с самого начала: имя пользователя не лежит в
    токене (там только идентификатор и роль), поэтому интерфейс не мог показать
    даже, под кем он работает. Менять своё имя и телефон было тоже нечем —
    это делал только администратор.
    """

    me = await users_repo.get(session, user.id)
    if me is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")
    return UserRead.model_validate(me)


#: За какой срок показываются действия администратора над учётной записью.
#: Неделя: сотрудник, ушедший в отпуск на выходные, увидит сообщение при
#: первом же входе, а не узнает о сбросе своего пароля из журнала.
ACCOUNT_NOTICE_WINDOW = timedelta(days=7)


@router.get(
    "/me/account-notices",
    response_model=list[AccountNotice],
    summary="Что администратор сделал с моей учётной записью",
)
async def list_my_account_notices(user: CurrentUserDep, session: SessionDep) -> list[AccountNotice]:
    """Сброс пароля и второго фактора, смена роли, передача пациентов (находка Н5).

    Администратор клинических данных не читает, но набор его законных действий
    складывается в доступ к ним: сбросить врачу пароль и фактор и войти им,
    передать его детей подконтрольной учётной записи. Всё это пишется в журнал
    — и врач о журнале не знает. Теперь кабинет показывает эти действия
    владельцу учётной записи при входе, неделю с момента действия: сброс,
    которого он не просил, — повод позвонить в клинику сразу.

    Канала, кроме кабинета, у сотрудника нет: Telegram сотрудники не
    привязывают, почты в продукте нет (решение G4). Читается из `audit_log`,
    своего хранилища у сообщений нет — им нечего хранить сверх журнала.
    """

    entries = await audit_repo.list_actions_on_account(
        session, user_id=user.id, since=datetime.now(UTC) - ACCOUNT_NOTICE_WINDOW
    )
    me = str(user.id)
    notices: list[AccountNotice] = []
    transfers: dict[tuple[str, datetime], int] = {}
    for entry in entries:
        if entry.action == "password_reset":
            notices.append(AccountNotice(kind="password_reset", at=entry.created_at))
        elif entry.action == "totp_reset":
            notices.append(AccountNotice(kind="totp_reset", at=entry.created_at))
        elif entry.action == "update":
            role_before = (entry.before or {}).get("role")
            role_after = (entry.after or {}).get("role")
            if role_before != role_after:
                notices.append(AccountNotice(kind="role_changed", at=entry.created_at))
        elif entry.action == "transfer_care":
            # Передача пишется строкой на каждого ребёнка, а в одной транзакции
            # у всех строк одно `created_at` (`now()` транзакции): по нему они
            # и собираются в одно сообщение с числом детей.
            kind = (
                "care_received"
                if (entry.after or {}).get("doctor_id") == me
                else "care_handed_over"
            )
            key = (kind, entry.created_at)
            transfers[key] = transfers.get(key, 0) + 1
    notices.extend(
        AccountNotice(kind=kind, at=at, count=count)  # type: ignore[arg-type]
        for (kind, at), count in transfers.items()
    )
    notices.sort(key=lambda notice: notice.at, reverse=True)
    return notices


@router.get("/me/language", response_model=LanguageRead, summary="Свой язык в боте и приложении")
async def read_my_language(user: CurrentUserDep, session: SessionDep) -> LanguageRead:
    """Язык семейных каналов (ADR-0052).

    Читают бот и Mini App: язык — свойство человека, и выбор, сделанный в
    одном канале, обязан дойти до другого. Пусто — человек не выбирал.
    """

    me = await users_repo.get(session, user.id)
    if me is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")
    return LanguageRead(language=languages.known_or_none(me.language))


@router.put("/me/language", response_model=LanguageRead, summary="Выбрать свой язык")
async def update_my_language(
    payload: LanguageUpdate, request: Request, user: CurrentUserDep, session: SessionDep
) -> LanguageRead:
    """Сохранить язык бота, Mini App и сообщений в Telegram (ADR-0052).

    Любая роль может сохранить себе язык, но читают его только семейные
    каналы: кабинет в браузере остаётся русским.

    В журнал пишется (находка Н14): это правка учётной записи, а «операции с
    учётками» раздел 4.2 ТЗ велит журналировать. Язык решает, на каком языке
    уходят сообщения о безопасности учётной записи, — смена языка чужой
    открытой сессией тоже вопрос «кто и когда».
    """

    me = await users_repo.get(session, user.id)
    if me is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")
    before = me.language
    updated = await users_repo.update(session, user=me, language=payload.language)
    if before != updated.language:
        await audit_repo.write_audit_log(
            session,
            user_id=me.id,
            action="language_changed",
            entity="users",
            entity_id=me.id,
            before={"language": before},
            after={"language": updated.language},
            ip=client_address(request),
        )
    return LanguageRead(language=languages.known_or_none(updated.language))


@router.patch("/me", response_model=UserRead, summary="Изменить свой профиль")
async def update_me(
    payload: MeUpdate, request: Request, user: CurrentUserDep, session: SessionDep
) -> UserRead:
    me = await users_repo.get(session, user.id)
    if me is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")

    changes = payload.model_dump()
    before = {key: getattr(me, key) for key in changes}
    updated = await users_repo.update(session, user=me, **changes)
    after = {key: getattr(updated, key) for key in changes}
    if before != after:
        # Та же правка администратором пишется (`services/admin.py`), своя —
        # нет; а «кто сменил телефон, по которому врач звонит семье» спрашивают
        # именно после инцидента (находка Н14).
        await audit_repo.write_audit_log(
            session,
            user_id=me.id,
            action="profile_updated",
            entity="users",
            entity_id=me.id,
            before=before,
            after=after,
            ip=client_address(request),
        )
    return UserRead.model_validate(updated)


@router.post(
    "/me/credentials",
    response_model=UserRead,
    status_code=201,
    summary="Задать вход в веб-кабинет",
    dependencies=[Depends(require_roles(UserRole.PARENT))],
)
@limiter.limit(AUTH_RATE_LIMIT)
async def set_credentials(
    payload: CredentialsCreate,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> UserRead:
    """Включает веб-кабинет родителю, заведённому из Telegram (ADR-0040).

    Веб для такой семьи необязателен и включается ею самой. До этого вызова у
    учётной записи нет ни почты, ни пароля: её удостоверяет Telegram.

    Повторный вызов отвергается (409): иначе чужая открытая сессия в Mini App
    перевела бы кабинет на свою почту. Смена пароля — в `/users/me/password`,
    сброс забытого — `/users/me/credentials/reset` (ADR-0051): почту он не
    меняет и требует свежей подписи Telegram.

    Токенов не выдаёт: сессия у вызвавшего уже есть, а `password_changed_at`
    здесь не ставится — обрывать нечего, прежним паролем никто не входил.

    Из Mini App — только с устройства, которому учётная запись доверяет
    (`_require_established_chat`, находки Н2 и Н7), и с сообщением во все её
    чаты: кабинет, заведённый чужой рукой, иначе жил бы незаметно для
    владельца.
    """

    me = await users_repo.get(session, user.id)
    if me is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")

    if user.channel == "miniapp":
        link = (
            await telegram_repo.get_active_link(session, user.binding_id)
            if user.binding_id is not None
            else None
        )
        if link is None:
            raise ApiError(ErrorCode.FORBIDDEN, "Привязка отозвана, откройте приложение заново.")
        await _require_established_chat(session, me, telegram_user_id=link.chat_id)

    if me.has_web_credentials:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Вход в кабинет уже настроен: пароль меняется в профиле.",
        )

    # Занятость почты проверяется до записи: уникальный индекс дал бы 500, а
    # человеку нужно объяснение — у него, скорее всего, уже есть кабинет,
    # заведённый по коду от врача.
    if await users_repo.get_by_email(session, payload.email) is not None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Эта почта уже занята. Войдите в кабинет и добавьте ребёнка по коду.",
        )

    me.email = payload.email
    me.password_hash = await hash_password_async(payload.password)
    # `password_changed_at` НЕ ставится: эта отметка обрывает прежние сессии, а
    # обрывать нечего — пароля до сих пор не было. Поставленная, она выкинула бы
    # родителя из Mini App ровно в тот момент, когда он включил себе кабинет.
    await session.flush()

    await audit_repo.write_audit_log(
        session,
        user_id=me.id,
        action="set_credentials",
        entity="users",
        entity_id=me.id,
        after={"email": me.email},
        ip=client_address(request),
    )
    # Во все чаты учётной записи, включая этот: «вход в кабинет включён» —
    # событие, о котором владелец обязан узнать, даже если включал не он.
    after_commit.defer(session, "notify_account_security", str(me.id), "web_credentials_set")
    return UserRead.model_validate(me)


@router.post(
    "/me/credentials/reset",
    status_code=204,
    summary="Задать новый пароль кабинета из Telegram",
    dependencies=[Depends(require_roles(UserRole.PARENT))],
)
@limiter.limit(AUTH_RATE_LIMIT)
async def reset_password_via_telegram(
    payload: PasswordResetViaTelegram,
    request: Request,
    user: CurrentUserDep,
    session: SessionDep,
) -> None:
    """Забытый пароль кабинета — сбросить там, где семья живёт (аудит, E3).

    Прежде пароль родителю сбрасывал только администратор клиники, хотя
    личность родителя уже подтверждает Telegram: Mini App открывается подписью
    его аккаунта. Как у сервисов, восстанавливающих доступ через проверенный
    второй канал, сброс разрешён только из Mini App — не из кабинета (там
    пароль меняют, зная прежний) и не ботом (сервисный токен — не человек).

    Риск чужого разблокированного телефона закрывают два свойства: почту отсюда
    не сменить — кабинет остаётся на почте владельца, — и во все чаты этого
    взрослого приходит сообщение о смене пароля. Отметка смены пароля обрывает
    прежние сессии кабинета; Mini App после ответа открывает свою заново.
    """

    if user.channel != "miniapp":
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Новый пароль без прежнего задаётся только в приложении в Telegram.",
        )
    me = await users_repo.get(session, user.id)
    if me is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")
    signer = await _require_fresh_launch(session, payload.init_data, parent_id=me.id)
    if not me.has_web_credentials or me.email is None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Кабинет ещё не включён: задайте почту и пароль в блоке «Вход в кабинет».",
        )
    await _require_established_chat(session, me, telegram_user_id=signer)

    me.password_hash = await hash_password_async(payload.password)
    me.password_changed_at = datetime.now(UTC)
    me.password_change_required = False
    await session.flush()
    await login_throttle.reset(me.email)

    await audit_repo.write_audit_log(
        session,
        user_id=me.id,
        action="password_reset_via_telegram",
        entity="users",
        entity_id=me.id,
        ip=client_address(request),
    )
    after_commit.defer(session, "notify_password_changed", str(me.id))


@router.post("/me/password", response_model=TokenPair, summary="Сменить свой пароль")
@limiter.limit(AUTH_RATE_LIMIT)
async def change_password(
    payload: PasswordChange,
    request: Request,
    response: Response,
    user: CurrentUserDep,
    session: SessionDep,
) -> TokenPair:
    """Меняет пароль и обрывает все прежние сессии (раздел 11 ТЗ).

    Отзыв работает через отметку `password_changed_at`: она попадает в claim
    новых токенов, а любой токен с меньшей отметкой отвергается при следующей
    же проверке. Хранилища выданных токенов для этого не нужно.

    Вызвавшему сразу выдаётся новая пара — иначе смена пароля выкидывала бы из
    приложения того, кто её сделал.
    """

    me = await users_repo.get(session, user.id)
    if me is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Учётная запись не найдена.")

    # У родителя из Telegram пароля может не быть вовсе (ADR-0040): менять
    # нечего, и «текущий пароль неверен» тут было бы неправдой. Оракула здесь
    # нет — человек спрашивает про свою собственную учётную запись.
    if me.password_hash is None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "У этой учётной записи ещё нет пароля — сначала задайте вход в кабинет.",
        )

    if not await verify_password_async(me.password_hash, payload.current_password):
        await audit_repo.write_audit_log_independent(
            user_id=me.id,
            action="password_change_failed",
            entity="users",
            entity_id=me.id,
            ip=client_address(request),
        )
        raise ApiError(ErrorCode.UNAUTHORIZED, "Текущий пароль указан неверно.")

    if payload.new_password == payload.current_password:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Новый пароль совпадает с текущим.")

    me.password_hash = await hash_password_async(payload.new_password)
    me.password_changed_at = datetime.now(UTC)
    await session.flush()

    await audit_repo.write_audit_log(
        session,
        user_id=me.id,
        action="password_changed",
        entity="users",
        entity_id=me.id,
        ip=client_address(request),
    )

    # Момент входа переносится: смена пароля — повторный ввод одного фактора,
    # без второго, и не должна продлевать сутки сессии сотрудника (замечание
    # ревью E6, 05.10.2026).
    started = _login_moment(request)
    tokens = TokenPair(
        access_token=create_token(
            user_id=me.id,
            role=me.role,
            token_type="access",
            password_changed_at=me.password_changed_at,
            auth_time=started,
        ),
        refresh_token=create_token(
            user_id=me.id,
            role=me.role,
            token_type="refresh",
            password_changed_at=me.password_changed_at,
            auth_time=started,
        ),
    )
    tokens = set_auth_cookies(response, tokens)
    return tokens


def _login_moment(request: Request) -> int | None:
    """Момент входа паролем из предъявленного токена доступа, если он есть."""

    try:
        claims = decode_token(bearer_token(request), expected_type="access")
    except ApiError:
        return None
    started = claims.get("auth")
    return started if isinstance(started, int) else None


#: Насколько свежей должна быть подпись Telegram при сбросе пароля. Строка
#: запуска живёт час (`telegram_initdata.MAX_AGE`); для сброса — десять минут:
#: приложение открыто только что, телефон в руках владельца (замечание ревью
#: E3-2, 05.10.2026). Заодно перезапуск после сброса гарантированно войдёт.
_FRESH_LAUNCH = timedelta(minutes=10)


async def _require_fresh_launch(session: SessionDep, raw: str, *, parent_id: uuid.UUID) -> int:
    """Свежая подпись запуска от чата этого взрослого; возвращает Telegram подписавшего."""

    stale = ApiError(
        ErrorCode.FORBIDDEN,
        "Для смены пароля закройте приложение и откройте его снова — так мы убедимся, "
        "что телефон у вас.",
        details={"reason": "stale_launch"},
    )
    try:
        launch = parse_init_data(raw, bot_token=get_settings().bot_token or "")
    except InitDataError as exc:
        raise stale from exc
    if datetime.now(UTC) - launch.auth_date > _FRESH_LAUNCH:
        raise stale
    # Подпись — именно этого взрослого: личный чат с ботом, привязанный к нему.
    # Чат ведёт нескольких детей (ADR-0048), и привязки могут стоять за разными
    # учётными записями; достаточно, чтобы хотя бы одна живая была его.
    links = await telegram_repo.list_active_links_by_chat(session, launch.user_id)
    if not any(link.parent_id == parent_id for link in links):
        raise stale
    return launch.user_id


#: Сколько чат, подключённый к учётной записи, должен прожить, прежде чем с
#: него можно задать или сбросить вход в кабинет (находки Н2 и Н7).
#:
#: Сутки — потому что сообщение о подключении нового устройства уходит во все
#: прочие чаты учётной записи сразу (`notify_account_security`), и у владельца,
#: чей код «своего чата» дошёл не до того человека, есть день, чтобы заметить
#: его и попросить врача отключить устройство. Так поступает и сам Telegram:
#: только что подключённое устройство не может завершать прежние сеансы, пока
#: не пройдёт время. Меньше суток — владелец может проспать сообщение, больше —
#: честный второй телефон ждёт без пользы.
NEW_DEVICE_HOLD = timedelta(hours=24)


async def _require_established_chat(
    session: SessionDep, me: User, *, telegram_user_id: int
) -> None:
    """С этого Telegram вправе задавать вход в кабинет учётной записи (Н2, Н7).

    «Чат привязан к учётной записи» — не то же, что «это её владелец»: чат
    привязывается и кодом «своего чата», а код могли переслать или
    сфотографировать. Прежде такой чат ставил на учётную запись свою почту и
    пароль (`/users/me/credentials`) или выбивал владельца сбросом
    (`/users/me/credentials/reset`) — и получал веб-доступ ко всем её детям.

    Два случая:

    1. **Это Telegram, которым учётная запись заведена** (`users.telegram_user_id`
       — его ставит только активация кода в боте новым человеком). Он и есть её
       удостоверение — пропускается сразу: семья, вышедшая с приёма, включает
       кабинет в тот же день.
    2. **Любой другой чат этой учётной записи** — подключённый кодом своего
       чата или учётной записи, заведённой в вебе. Пропускается, только если
       прожил `NEW_DEVICE_HOLD`.
    """

    if me.telegram_user_id is not None and me.telegram_user_id == telegram_user_id:
        return
    links = [
        link
        for link in await telegram_repo.list_active_links_by_chat(session, telegram_user_id)
        if link.parent_id == me.id
    ]
    oldest = min((link.linked_at for link in links), default=None)
    if oldest is None or datetime.now(UTC) - oldest < NEW_DEVICE_HOLD:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Этот Telegram подключён к учётной записи меньше суток назад. Задать или "
            "сбросить вход в кабинет с него можно будет через сутки после подключения — "
            "или сейчас с того Telegram, с которого семья подключалась первой.",
            details={"reason": "new_device"},
        )
