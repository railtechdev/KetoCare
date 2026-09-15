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

from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.models import AccessCode, Patient, User
from core.models.enums import UserRole
from core.repositories import access as access_repo
from core.repositories import access_codes as codes_repo
from core.repositories import audit as audit_repo
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo

from ..errors import ApiError, ErrorCode
from ..schemas_access import AccessCodeCreated, AccessCodeRead, AccessCodeStatus
from ..security import hash_password_async
from . import telegram as telegram_service


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
_CODE_INVALID = "Код недействителен или истёк. Попросите у врача новый код доступа."


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
    session: AsyncSession, *, patient_id: uuid.UUID, issuer: Actor, ip: str | None
) -> AccessCodeCreated:
    """Выпускает код и пишет выдачу в журнал.

    Срок жизни выбирается по роли выдавшего внутри репозитория (решение 5
    ADR-0040): у специалиста неделя, у родителя четверть часа.
    """

    code = await codes_repo.create(
        session, patient_id=patient_id, issued_by=issuer.id, role=issuer.role
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
        after={"code": code.code, "expires_at": code.expires_at.isoformat()},
    )

    return AccessCodeCreated(
        code=code.code,
        expires_at=code.expires_at,
        deep_link=telegram_service.build_deep_link(code.code),
        join_url=_join_url(code.code),
    )


async def journal(session: AsyncSession, *, patient_id: uuid.UUID) -> list[AccessCodeRead]:
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
            code=code.code,
            status=_status(code, now=now),
            expires_at=code.expires_at,
            created_at=code.created_at,
            used_at=code.used_at,
            revoked_at=code.revoked_at,
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
    Для кода, выпущенного самим родителем (этап Б), проверка та же: связь
    родителя с ребёнком могла исчезнуть.
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
    await codes_repo.release(session, code=code.code)
    raise ApiError(
        ErrorCode.CONFLICT,
        "Код больше не действует: выдавший его специалист не ведёт этого ребёнка. "
        "Попросите лечащего врача выдать новый.",
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

    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    await codes_repo.mark_used_by(session, code=code.code, user_id=parent.id)

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

    claimed = await _claim_or_refuse(session, code)
    await _require_live_issuer(session, claimed)

    if await users_repo.get_by_email(session, email) is not None:
        # Код возвращается: человек просто уже зарегистрирован, и его путь —
        # войти и добавить ребёнка по этому же коду.
        await codes_repo.release(session, code=claimed.code)
        raise ApiError(
            ErrorCode.CONFLICT,
            "Эта почта уже занята. Войдите и добавьте ребёнка по коду в настройках.",
        )

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
        after={"email": parent.email, "role": parent.role.value, "code": claimed.code},
    )

    patient = await _attach_parent(session, code=claimed, parent=parent, ip=ip)
    return parent, patient


async def activate_for_user(
    session: AsyncSession, *, code: str, parent: Actor, ip: str | None
) -> Patient:
    """Активация тем, кто уже вошёл: второй ребёнок или второй родитель с учёткой."""

    claimed = await _claim_or_refuse(session, code)
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
