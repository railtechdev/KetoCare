"""Выдача и активация кодов доступа семьи (ADR-0040).

Здесь живёт всё, что решает, кому достанется доступ к данным ребёнка: роутеры
остаются тонкими намеренно — правило доступа, разложенное по трём ручкам,
однажды разойдётся между ними.

Три пути активации ведут в одно место (`_attach_parent`): веб незнакомого
человека, веб уже вошедшего родителя и — начиная с этапа Б плана — бот. Разные
у них только способ появления учётной записи.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Protocol

import structlog
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.models import AccessCode, Patient, TelegramAccount, User
from core.models.enums import AccessCodePurpose, UserRole
from core.repositories import access as access_repo
from core.repositories import access_codes as codes_repo
from core.repositories import audit as audit_repo
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo
from core.repositories import users as users_repo

from .. import after_commit
from ..errors import ApiError, ErrorCode
from ..schemas_access import AccessCodeCreated, AccessCodeRead, AccessCodeStatus
from ..security import hash_password_async
from . import telegram as telegram_service

logger = structlog.get_logger(__name__)


class Actor(Protocol):
    """Кто действует: сессия (`CurrentUser`) или запись пользователя (`User`).

    Сервису нужны от действующего лица ровно две вещи — идентификатор и роль, —
    и приходят они из разных мест: роутер даёт сессию, а активация по коду
    создаёт учётную запись и передаёт её же. Протокол избавляет от выбора «либо
    лишний запрос в базу, либо два почти одинаковых кода пути».
    """

    # Только чтение: `CurrentUser` — замороженный dataclass, и объявленные
    # изменяемыми члены протокола он бы не удовлетворил.
    @property
    def id(self) -> uuid.UUID: ...

    @property
    def role(self) -> UserRole: ...


#: Один ответ на все три негодности кода: не существует, истёк, погашен, отозван.
#: Разные тексты сообщали бы подбирающему, что код существовал, — а семье они
#: одинаково бесполезны: действие всё равно одно, попросить у врача новый.
_CODE_INVALID = (
    "Код не подошёл: он истёк, уже использован или набран с ошибкой. "
    "Попросите новый код у того, кто его прислал, — у врача или у родителя ребёнка."
)


def _status(code: AccessCode, *, now: datetime) -> AccessCodeStatus:
    if code.revoked_at is not None:
        return "revoked"
    if code.used_at is not None:
        return "used"
    if code.expires_at <= now:
        return "expired"
    return "pending"


def _join_url(code: str) -> str:
    origin = get_settings().web_origin.rstrip("/")
    return f"{origin}/join?code={code}"


async def issue(
    session: AsyncSession,
    *,
    patient_id: uuid.UUID,
    issuer: Actor,
    purpose: AccessCodePurpose,
    channel: str,
    ip: str | None,
) -> AccessCodeCreated:
    """Выпускает код и пишет выдачу в журнал.

    Срок жизни выбирается по назначению внутри репозитория (ADR-0042): у кода
    для другого взрослого неделя, у кода своего чата четверть часа.
    """

    code = await codes_repo.create(
        session, patient_id=patient_id, issued_by=issuer.id, purpose=purpose
    )

    # Выдача доступа к клиническим данным — операция с учётными записями по
    # правилу 7: без записи нельзя ответить, кто открыл семье карту ребёнка.
    # Объект записи — ребёнок, а не код: в журнале ищут по пациенту.
    await audit_repo.write_audit_log(
        session,
        user_id=issuer.id,
        action="access_code_issued",
        entity="access_codes",
        entity_id=patient_id,
        ip=ip,
        after={
            "code": code.code,
            "purpose": code.purpose.value,
            # Откуда выдан: кабинет или Mini App. Выдача из телефона — новое
            # право (ADR-0043), и разбор «кто позвал чужого» начинается с этого.
            "channel": channel,
            "expires_at": code.expires_at.isoformat(),
        },
    )

    return AccessCodeCreated(
        code=code.code,
        expires_at=code.expires_at,
        # Ссылка в бота — главный путь семьи с этапа Б: бот принимает этот же
        # код (`/auth/access-codes/activate-telegram`). До этапа Б поле стояло
        # пустым намеренно — бот понимал только коды привязки и ответил бы
        # «код недействителен» на главном экране новой функции.
        deep_link=telegram_service.build_deep_link(code.code),
        join_url=_join_url(code.code),
    )


def _visible_code(code: AccessCode, *, viewer_id: uuid.UUID) -> str | None:
    """Значение кода своего чата видит только выпустивший его.

    Такой код привязывает чат к учётной записи выдавшего, а не к тому, кто его
    ввёл. Журнал читают все взрослые при ребёнке и его специалисты, и любой из
    них, прочитав чужой живой код, подключил бы свой Telegram к чужой учётной
    записи — дальше его записи в дневнике шли бы от имени другого человека.
    Код для другого взрослого так не устроен: он заводит учётную запись
    вошедшему, и выдать такой же может каждый, кто его видит.
    """

    if code.purpose is AccessCodePurpose.OWN_CHAT and code.issued_by != viewer_id:
        return None
    return code.code


async def journal(
    session: AsyncSession, *, patient_id: uuid.UUID, viewer_id: uuid.UUID
) -> list[AccessCodeRead]:
    """Журнал кодов ребёнка с именами участников."""

    codes = await codes_repo.list_for_patient(session, patient_id=patient_id)
    now = datetime.now(UTC)

    names: dict[uuid.UUID, str] = {}
    for code in codes:
        for user_id in (code.issued_by, code.used_by):
            if user_id is not None and user_id not in names:
                user = await users_repo.get(session, user_id)
                if user is not None:
                    names[user_id] = user.full_name

    return [
        AccessCodeRead(
            code=_visible_code(code, viewer_id=viewer_id),
            status=_status(code, now=now),
            expires_at=code.expires_at,
            created_at=code.created_at,
            used_at=code.used_at,
            revoked_at=code.revoked_at,
            purpose=code.purpose,
            issued_by_name=names.get(code.issued_by),
            used_by_name=names.get(code.used_by) if code.used_by is not None else None,
        )
        for code in codes
    ]


async def revoke(
    session: AsyncSession, *, patient_id: uuid.UUID, code: str, actor: Actor, ip: str | None
) -> None:
    revoked = await codes_repo.revoke(session, code=code, patient_id=patient_id)
    if revoked is None:
        # Погашенный, уже отозванный и чужой код отвечают одинаково: отзывать
        # нечего. Разделять эти случаи значит рассказывать, какие коды есть у
        # чужого ребёнка.
        raise ApiError(ErrorCode.CONFLICT, "Этот код уже использован или отозван.")

    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action="access_code_revoked",
        entity="access_codes",
        entity_id=patient_id,
        ip=ip,
        after={"code": revoked.code},
    )


async def _claim_or_refuse(session: AsyncSession, code: str) -> AccessCode:
    claimed = await codes_repo.claim(session, code)
    if claimed is None:
        raise ApiError(ErrorCode.NOT_FOUND, _CODE_INVALID)
    return claimed


async def _issuer_still_leads(session: AsyncSession, code: AccessCode) -> bool:
    """Выдавший активен и по-прежнему связан с ребёнком (правило ADR-0032).

    Код живёт неделю, и специалист, которого за это время сняли с пациента или
    отключили, иначе продолжал бы раздавать доступ к ребёнку уже выданным кодом.
    Для кода, выпущенного родителем, проверка та же: его учётную запись могли
    отключить, а связь с ребёнком — убрать.
    """

    issuer = await users_repo.get(session, code.issued_by)
    if issuer is None or not issuer.is_active:
        return False
    return await access_repo.user_has_patient_access(
        session, user_id=issuer.id, role=issuer.role, patient_id=code.patient_id
    )


async def _require_live_issuer(session: AsyncSession, code: AccessCode) -> None:
    if await _issuer_still_leads(session, code):
        return
    # Код возвращается в обращение: семья не виновата в том, что специалиста
    # сняли с пациента, и сжигать её единственный код из-за чужого действия
    # нельзя — врачу пришлось бы выдавать новый.
    #
    # В бою то же самое делает откат транзакции (`get_session` откатывает её на
    # любом `ApiError`), и на него одного полагаться не стоит: он вернёт код,
    # пока отказ — последнее, что происходит в запросе. Появится между
    # погашением и отказом любая запись, которую нужно сохранить, — и откат
    # заберёт с собой уже не только код. Возврат здесь говорит о намерении
    # прямо, а не полагается на порядок строк (#240).
    await codes_repo.release(session, code=code.code)
    raise ApiError(
        ErrorCode.CONFLICT,
        "Код больше не действует: у того, кто его выдал, больше нет доступа к этому "
        "ребёнку. Попросите новый код у врача или у другого родителя ребёнка.",
        details={"reason": "issuer_lost_access"},
    )


async def _patient_or_refuse(session: AsyncSession, patient_id: uuid.UUID) -> Patient:
    # У самой карточки ребёнка мягкого удаления нет (раздел 4.2 ТЗ: `deleted_at`
    # стоит у дневников и меню, а не у пациента), поэтому проверка одна — есть
    # ли она вообще. Исчезнуть она может только через `erase_patient`, и тогда
    # вместе с ней исчезают и коды.
    patient = await patients_repo.get(session, patient_id)
    if patient is None:
        raise ApiError(ErrorCode.NOT_FOUND, _CODE_INVALID)
    return patient


async def _attach_parent(
    session: AsyncSession,
    *,
    code: AccessCode,
    parent: Actor,
    ip: str | None,
) -> Patient:
    """Привязывает родителя к ребёнку и пишет обе записи журнала.

    Идемпотентна по связи: `link_parent` в репозитории не создаёт дубля, а
    повторный код тому же человеку — это второе устройство, а не ошибка.
    """

    patient = await _patient_or_refuse(session, code.patient_id)

    newcomer = not await access_repo.user_has_patient_access(
        session, user_id=parent.id, role=parent.role, patient_id=patient.id
    )
    # Кто открыл доступ, записывается в саму связь и только при её создании:
    # код, погашенный уже подключённым взрослым, «пригласившим» его не делает
    # (иначе бабушка, чей код мама ввела для второго телефона, могла бы
    # закрыть маме доступ — находка ревью ADR-0043).
    await patients_repo.link_parent(
        session, parent_id=parent.id, patient_id=patient.id, invited_by=code.issued_by
    )
    await codes_repo.mark_used_by(session, code=code.code, user_id=parent.id)
    if newcomer and code.purpose is AccessCodePurpose.FAMILY_MEMBER:
        await _tell_the_family(session, code=code, newcomer_id=parent.id)

    await audit_repo.write_audit_log(
        session,
        user_id=parent.id,
        action="link_parent",
        entity="parent_patient",
        entity_id=patient.id,
        ip=ip,
        after={"code": code.code, "issued_by": str(code.issued_by)},
    )
    return patient


async def _tell_the_family(
    session: AsyncSession, *, code: AccessCode, newcomer_id: uuid.UUID
) -> None:
    """Остальные взрослые при ребёнке узнают о новом близком (ADR-0043).

    Как у Family Link, который пишет о каждой смене родительских прав: доступ к
    данным ребёнка не должен появляться тихо. Если код ушёл не тому человеку —
    с потерянного телефона или по ошибке, — первой это заметит семья, и
    сообщение говорит, где закрыть доступ.

    Задача уходит только после коммита (`after_commit.defer`): активация из
    бота ещё может откатиться на гонке двух кодов за один чат, и семья иначе
    получила бы весть о подключении, которого не было. Имена — аргументами:
    так воркеру не нужно читать учётную запись, которой на момент постановки
    ещё нет в базе.
    """

    newcomer = await users_repo.get(session, newcomer_id)
    inviter = await users_repo.get(session, code.issued_by)
    if newcomer is None:
        return
    after_commit.defer(
        session,
        "notify_family_joined",
        str(code.patient_id),
        str(newcomer_id),
        newcomer.full_name,
        inviter.full_name if inviter is not None else None,
    )


async def _require_web_code(session: AsyncSession, code: AccessCode) -> None:
    """Код своего чата в вебе не действует — он подключает Telegram (ADR-0042).

    Родитель выпускает его себе на пятнадцать минут, чтобы подключить ещё один
    чат. Отказ решает назначение кода, а не роль выдавшего: доступ другому
    взрослому родитель выдаёт явно — кодом с назначением `family_member`, с
    неделей жизни и пояснением на экране, — а не тем, что код своего чата
    случайно сработал на `/join`.
    """

    if code.purpose is not AccessCodePurpose.OWN_CHAT:
        return

    # Код возвращается в обращение: он предназначался боту и ещё пригодится.
    await codes_repo.release(session, code=code.code)
    raise ApiError(
        ErrorCode.CONFLICT,
        "Этот код подключает Telegram и в кабинете не действует. "
        "Чтобы открыть кабинет ещё одному взрослому, выпустите для него код в разделе "
        "«Ребёнок» → «Кто ведёт».",
    )


async def activate_new_account(
    session: AsyncSession,
    *,
    code: str,
    email: str,
    full_name: str,
    password: str,
    phone: str | None,
    ip: str | None,
) -> tuple[User, Patient]:
    """Активация незнакомым системе человеком: заводится учётная запись родителя."""

    # Почта проверяется ДО погашения: иначе каждая проверка гасила код и
    # возвращала его обратно, а «обратно» держалось на откате транзакции, а не
    # на самом возврате (#240). Здесь код ещё не тронут, и объяснять нечего.
    if await users_repo.get_by_email(session, email) is not None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Эта почта уже занята. Войдите в кабинет и откройте «Ребёнок» → "
            "«Добавить ребёнка по коду».",
        )

    claimed = await _claim_or_refuse(session, code)
    await _require_web_code(session, claimed)
    await _require_live_issuer(session, claimed)

    parent = await users_repo.create(
        session,
        role=UserRole.PARENT,
        full_name=full_name,
        email=email,
        password_hash=await hash_password_async(password),
        phone=phone,
        # След от выдачи к учётной записи: он же определяет ведущего
        # специалиста (ADR-0003), если карта заведена не им.
        invited_by=claimed.issued_by,
    )

    await audit_repo.write_audit_log(
        session,
        user_id=parent.id,
        action="accept_access_code",
        entity="users",
        entity_id=parent.id,
        ip=ip,
        # Кода здесь нет намеренно: сущность `users` показывается администратору
        # с нагрузкой, а сам код уже записан в `access_code_issued`, который
        # скрыт. Держать строку-доступ в видимом журнале незачем.
        after={"email": parent.email, "role": parent.role.value},
    )

    patient = await _attach_parent(session, code=claimed, parent=parent, ip=ip)
    return parent, patient


async def activate_for_user(
    session: AsyncSession, *, code: str, parent: Actor, ip: str | None
) -> Patient:
    """Активация тем, кто уже вошёл: второй ребёнок или второй родитель с учёткой."""

    claimed = await _claim_or_refuse(session, code)
    await _require_web_code(session, claimed)
    await _require_live_issuer(session, claimed)

    already = await access_repo.user_has_patient_access(
        session, user_id=parent.id, role=parent.role, patient_id=claimed.patient_id
    )
    if already:
        # Код возвращается в обращение: он предназначался кому-то ещё, и сжечь
        # его случайным повторным вводом значит отобрать доступ у второго
        # взрослого.
        await codes_repo.release(session, code=claimed.code)
        raise ApiError(ErrorCode.CONFLICT, "Этот ребёнок уже есть в вашем кабинете.")

    return await _attach_parent(session, code=claimed, parent=parent, ip=ip)


#: Занятый чат отвечает одинаково и до погашения кода, и на гонке вставки.
_CHAT_TAKEN = "Этот чат уже привязан. Сначала отвяжите его в кабинете."


async def activate_from_telegram(
    session: AsyncSession,
    *,
    code: str,
    chat_id: int,
    telegram_user_id: int,
    first_name: str,
    last_name: str | None,
    ip: str | None,
) -> tuple[User, Patient, TelegramAccount, str]:
    """Активация кода прямо в боте (ADR-0040, этап Б).

    Третий и главный путь: семья выходит от врача с кодом на руках и открывает
    бота, не заводя ни почты, ни пароля. Учётную запись такого родителя
    удостоверяет `telegram_user_id`, а веб он включает сам и потом
    (`POST /users/me/credentials`).

    Порядок шагов — тот же, что был у кода привязки: занятость чата
    проверяется ДО погашения, иначе чужая привязка сжигала бы код семьи, и она
    получала бы отказ, ничего не сделав неправильно.

    Возвращает то же, из чего собирается `LinkVerified`: бот не должен
    различать, каким кодом родитель пришёл.
    """

    existing = await telegram_repo.get_active_link_by_chat(session, chat_id)
    if existing is not None:
        # Бот подбирает текст по причине: «этот ребёнок уже здесь» и «чат занят
        # другим ребёнком» — разные ситуации с разным следующим шагом, а одна
        # формулировка на обе отправляла бабушку отвязывать чат в кабинете,
        # которого у неё нет.
        peeked = await codes_repo.get(session, code)
        same_child = peeked is not None and peeked.patient_id == existing.patient_id
        raise ApiError(
            ErrorCode.CONFLICT,
            "Этот чат уже ведёт дневник этого ребёнка." if same_child else _CHAT_TAKEN,
            details={"reason": "already_here" if same_child else "chat_taken"},
        )

    claimed = await _claim_or_refuse(session, code)
    await _require_live_issuer(session, claimed)

    parent = await _parent_behind_telegram(
        session,
        code=claimed,
        telegram_user_id=telegram_user_id,
        first_name=first_name,
        last_name=last_name,
        ip=ip,
    )

    patient = await _attach_parent(session, code=claimed, parent=parent, ip=ip)

    secret = telegram_repo.generate_binding_secret()
    try:
        link = await telegram_repo.create_link(
            session,
            parent_id=parent.id,
            patient_id=patient.id,
            chat_id=chat_id,
            secret=secret,
        )
    except IntegrityError as exc:
        # Проверка занятости и вставка — не одна операция: два запроса с разными
        # кодами на один чат оба пройдут проверку. Частичный уникальный индекс их
        # разведёт, но без перехвата второй получил бы 500 вместо объяснения.
        raise ApiError(ErrorCode.CONFLICT, _CHAT_TAKEN) from exc

    await audit_repo.write_audit_log(
        session,
        user_id=parent.id,
        action="telegram_link",
        entity="telegram_accounts",
        entity_id=link.id,
        ip=ip,
        after={"chat_id": link.chat_id, "patient_id": str(link.patient_id)},
    )
    return parent, patient, link, secret


async def _parent_behind_telegram(
    session: AsyncSession,
    *,
    code: AccessCode,
    telegram_user_id: int,
    first_name: str,
    last_name: str | None,
    ip: str | None,
) -> User:
    """Чья учётная запись стоит за этим Telegram — найденная, своя или новая.

    Три случая, и путать их нельзя:

    1. **Этот Telegram уже знаком.** Человек привязывает ещё один чат или ещё
       одного ребёнка. Учётная запись та же.
    2. **Код своего чата** (`own_chat`: родитель выпустил его себе, «подключить
       ещё один чат»). Чат привязывается к учётной записи выдавшего — как это
       делал код привязки, — но удостоверением она от этого не обзаводится: см.
       комментарий в самой ветке.
    3. **Код для другого взрослого** (`family_member`, выдал специалист или
       родитель), и Telegram незнаком: пришёл кто-то новый — первый родитель,
       второй взрослый. Учётная запись рождается здесь.
    """

    known = await users_repo.get_by_telegram_user_id(session, telegram_user_id)
    if known is not None:
        if known.role is not UserRole.PARENT:
            # Колонка общая для всех ролей, и сотрудник, привязавший однажды свой
            # Telegram, иначе получил бы ребёнка в родительские права — тихо и
            # мимо всех проверок ролей.
            raise ApiError(
                ErrorCode.CONFLICT,
                "Этот Telegram принадлежит сотруднику клиники и не может вести дневник ребёнка.",
                details={"reason": "staff_telegram"},
            )
        return known

    if code.purpose is AccessCodePurpose.OWN_CHAT:
        issuer = await users_repo.get(session, code.issued_by)
        if issuer is None or issuer.role is not UserRole.PARENT:
            # Схема и ручка такого кода не допускают; отказ здесь — на случай
            # строки, заведённой мимо них, чтобы чат не ушёл сотруднику.
            await codes_repo.release(session, code=code.code)
            raise ApiError(ErrorCode.NOT_FOUND, _CODE_INVALID)
        # `telegram_user_id` здесь НЕ проставляется, хотя это и выглядело бы
        # удобным. Код мог дойти не до того человека — родитель сам передал его
        # второму взрослому, — и тогда чужой Telegram навсегда стал бы
        # удостоверением этой учётной записи. Дальше он был бы «знакомым»
        # (случай 1), и код врача на ДРУГОГО ребёнка привязал бы того ребёнка к
        # учётной записи первого родителя, открыв ему чужую семью.
        #
        # Цена отказа: родитель с кабинетом, активировавший позже код врача на
        # второго ребёнка прямо в боте, получит вторую учётную запись. Это видно
        # врачу (в карте два родителя) и поправимо, а тихий доступ к чужим
        # клиническим данным — нет. Второго ребёнка такой родитель добавляет в
        # кабинете (`POST /users/me/access-codes/activate`).
        return issuer

    try:
        parent = await users_repo.create(
            session,
            role=UserRole.PARENT,
            full_name=" ".join(part for part in (first_name, last_name) if part),
            telegram_user_id=telegram_user_id,
            # Ни почты, ни пароля: их у человека нет, и выдумывать их за него
            # значит завести учётную запись, вход в которую он не проходил.
            invited_by=code.issued_by,
        )
    except IntegrityError as exc:
        # Два `/start` с разными кодами из одного нового Telegram: проверка выше
        # и вставка здесь — не одна операция. Частичный уникальный индекс их
        # разведёт, но без перехвата второй получил бы 500.
        raise ApiError(ErrorCode.CONFLICT, _CHAT_TAKEN) from exc
    await audit_repo.write_audit_log(
        session,
        user_id=parent.id,
        action="create_user",
        entity="users",
        entity_id=parent.id,
        ip=ip,
        after={"role": parent.role.value, "source": "telegram"},
    )
    return parent
