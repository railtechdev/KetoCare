"""Логика админских ручек: учётные записи, справочники, журнал аудита (раздел 5.3 ТЗ).

Здесь живёт всё, что не сводится к «прочитать и отдать»: запреты, ведущие к
потере администратора, проверка ссылок перед удалением значения справочника и
сокрытие клинической нагрузки в журнале.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.models import AuditLog, KetoneMethodDict, SeizureType, User
from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import backup_codes as backup_codes_repo
from core.repositories import dictionaries as dictionaries_repo
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo

from ..deps.auth import CurrentUser
from ..errors import ApiError, ErrorCode
from ..schemas_admin import (
    AdminUserUpdate,
    AuditLogRead,
    DictionaryEntryCreate,
    DictionaryEntryRead,
    DictionaryEntryUpdate,
)
from ..security import hash_password_async

# Сущности, для которых `before`/`after` можно показать администратору.
#
# Журнал аудита один на всю систему, и в нём лежат в том числе назначения,
# выгрузки и привязки Telegram — то есть данные конкретных пациентов. Админ к
# клиническим данным доступа не имеет (раздел 5.1 ТЗ), поэтому нагрузка
# отдаётся только для учётных записей и общего контента: там нет ни пациента,
# ни его показателей. Всё остальное видно как факт («кто, что, когда»), но без
# содержимого.
AUDIT_PAYLOAD_VISIBLE_ENTITIES = frozenset(
    {
        "users",
        "invitations",
        "products",
        "product_categories",
        "product_revisions",
        "recipes",
        "seizure_types",
        "ketone_methods",
    }
)


def audit_entry_to_schema(entry: AuditLog) -> AuditLogRead:
    visible = entry.entity in AUDIT_PAYLOAD_VISIBLE_ENTITIES
    has_payload = entry.before is not None or entry.after is not None
    return AuditLogRead(
        id=entry.id,
        user_id=entry.user_id,
        action=entry.action,
        entity=entry.entity,
        entity_id=entry.entity_id,
        before=entry.before if visible else None,
        after=entry.after if visible else None,
        payload_hidden=has_payload and not visible,
        # `audit_log.ip` — колонка INET, и драйвер отдаёт из неё объект
        # `ipaddress.IPv4Address`, а не строку, вопреки аннотации модели.
        ip=None if entry.ip is None else str(entry.ip),
        created_at=entry.created_at,
    )


def _account_snapshot(user: User) -> dict[str, Any]:
    """Снимок изменяемых полей учётной записи для `audit_log.before/after`.

    Только то, что может изменить эта ручка: журнал должен читаться как diff,
    а не как дамп строки.
    """

    return {
        "full_name": user.full_name,
        "phone": user.phone,
        "role": user.role.value,
        "is_active": user.is_active,
    }


#: Роли, ведущие пациентов. Отключение такой учётной записи снимает с пациентов
#: их специалиста, а «подобрать» осиротевшего пациента другой врач не может.
_CARE_ROLES = (UserRole.DOCTOR, UserRole.DIETITIAN)


async def update_user(
    session: AsyncSession,
    *,
    actor: CurrentUser,
    user_id: uuid.UUID,
    payload: AdminUserUpdate,
    ip: str | None,
) -> User:
    user = await users_repo.get(session, user_id)
    if user is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пользователь не найден.")

    changes = payload.model_dump(exclude_unset=True)

    if user.id == actor.id:
        # Оба действия отбирают у автора запроса доступ к /admin тем же запросом,
        # которым он их совершает. Если он последний администратор, вернуть права
        # будет некому — система останется без администрирования, и починить это
        # можно будет только руками в базе. Другого админа отключить и разжаловать
        # по-прежнему можно.
        if changes.get("is_active") is False:
            raise ApiError(
                ErrorCode.CONFLICT,
                "Нельзя отключить собственную учётную запись. Попросите другого администратора.",
            )
        if "role" in changes and changes["role"] is not user.role:
            raise ApiError(
                ErrorCode.CONFLICT,
                "Нельзя изменить роль собственной учётной записи. "
                "Попросите другого администратора.",
            )

    # Отключение специалиста и его разжалование обходили инвариант «пациент не
    # остаётся без ведущего»: связи в `doctor_patient` переживают отключение, а
    # войти по ним больше некому. Отказ здесь — тот же, что при снятии
    # специалиста вручную, и по той же причине.
    losing_care = changes.get("is_active") is False or (
        "role" in changes and changes["role"] is not user.role
    )
    if losing_care and user.role in _CARE_ROLES:
        orphans = await patients_repo.count_sole_doctor_patients(session, doctor_id=user.id)
        if orphans > 0:
            raise ApiError(
                ErrorCode.CONFLICT,
                "У этого специалиста есть пациенты, которых больше никто не ведёт "
                f"({orphans}). Сначала передайте их коллеге — это делает врач в "
                "карте пациента.",
            )

    before = _account_snapshot(user)
    updated = await users_repo.update(session, user=user, **changes)

    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action="update",
        entity="users",
        entity_id=updated.id,
        before=before,
        after=_account_snapshot(updated),
        ip=ip,
    )
    return updated


async def reset_totp(
    session: AsyncSession,
    *,
    actor: CurrentUser,
    user_id: uuid.UUID,
    ip: str | None,
) -> User:
    """Сбрасывает второй фактор: телефон утерян, резервные коды кончились.

    Это последняя ступень восстановления доступа. Первая — резервные коды,
    выданные при включении второго фактора; когда и они израсходованы или
    потеряны вместе с телефоном, вернуть человека в систему может только другой
    человек с правами администратора.

    Отключением второго фактора это не является: очищенный секрет означает, что
    при следующем входе учётная запись пройдёт первичную настройку 2FA заново
    (`totp_setup_required`). Раздел 7 ТЗ требует второго фактора для
    admin/doctor/dietitian, и обойти это требование сброс не позволяет.

    Резервные коды стираются вместе с секретом: они были выпущены под прежнее
    устройство, и оставить их значило бы оставить действующим тот самый набор,
    из-за потери которого сброс и понадобился.

    Свой собственный второй фактор администратор сбросить не может: доступ к
    открытой сессии превращался бы в способ снять второй фактор с себя, то есть
    в обход требования. Для этого есть другой администратор — так же, как с
    отключением собственной учётной записи.
    """

    if user_id == actor.id:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Нельзя сбросить собственный второй фактор. Попросите другого администратора.",
        )

    user = await users_repo.get(session, user_id)
    if user is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пользователь не найден.")

    if user.totp_secret is None and user.totp_pending_secret is None:
        raise ApiError(ErrorCode.CONFLICT, "У этой учётной записи второй фактор не настроен.")

    user.totp_secret = None
    user.totp_pending_secret = None
    await backup_codes_repo.drop_for_user(session, user_id=user.id)
    await session.flush()

    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action="totp_reset",
        entity="users",
        entity_id=user.id,
        ip=ip,
    )
    return user


#: Длина временного пароля. Он живёт до первого входа и не запоминается
#: человеком, поэтому читаемость важнее краткости: его диктуют по телефону.
TEMPORARY_PASSWORD_GROUPS = 4
TEMPORARY_PASSWORD_GROUP_LEN = 4

#: Тот же алфавит, что у кодов привязки и резервных кодов: без 0/O и 1/I/L.
TEMPORARY_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _generate_temporary_password() -> str:
    """Временный пароль вида `ABCD-EFGH-JKMN-PQRS`.

    `secrets`, а не `random`: это пароль к клиническим данным, пусть и на один
    вход. Двадцать знаков из алфавита в 31 символ — около 98 бит, что заведомо
    больше требований раздела 11 ТЗ к длине.
    """

    groups = [
        "".join(
            secrets.choice(TEMPORARY_PASSWORD_ALPHABET) for _ in range(TEMPORARY_PASSWORD_GROUP_LEN)
        )
        for _ in range(TEMPORARY_PASSWORD_GROUPS)
    ]
    return "-".join(groups)


async def reset_password(
    session: AsyncSession,
    *,
    actor: CurrentUser,
    user_id: uuid.UUID,
    ip: str | None,
) -> str:
    """Выдаёт временный пароль. Возвращает его в открытом виде — один раз.

    Восстановления пароля в продукте нет: почтовой рассылки нет вовсе, а
    единственная смена пароля требует знать текущий. Забывший пароль врач терял
    доступ к данным своих пациентов навсегда.

    Временный пароль передаётся голосом или в переписке, то есть заведомо
    известен двоим. Поэтому одновременно ставится `password_change_required`:
    вход по нему не выдаёт рабочей сессии, а ведёт к заданию своего пароля.

    `password_changed_at` обрывает все прежние сессии (раздел 11 ТЗ): если
    учётной записью успел воспользоваться посторонний, сброс закрывает и его
    сессию тоже.

    Свой собственный пароль администратор так не сбрасывает: смена своего
    пароля — отдельная ручка, требующая текущего. Здесь же он и так знает
    временный, и обход проверки ничего не даёт, кроме потери следа.
    """

    if user_id == actor.id:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Свой пароль меняйте в профиле — там нужен текущий.",
        )

    user = await users_repo.get(session, user_id)
    if user is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Пользователь не найден.")

    temporary = _generate_temporary_password()
    user.password_hash = await hash_password_async(temporary)
    user.password_changed_at = datetime.now(UTC)
    user.password_change_required = True
    await session.flush()

    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action="password_reset",
        entity="users",
        entity_id=user.id,
        ip=ip,
    )
    return temporary


# --- справочники ----------------------------------------------------------
#
# `seizure_types` и `ketone_methods` устроены одинаково, поэтому функции
# принимают модель. Имя сущности для аудита берётся из `__tablename__`, а не
# передаётся строкой: строку легко разойтись с таблицей при копировании ручки.


async def _entry_or_404[T: (SeizureType, KetoneMethodDict)](
    session: AsyncSession, model: type[T], entry_id: uuid.UUID
) -> T:
    entry = await dictionaries_repo.get(session, model, entry_id)
    if entry is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Значение справочника не найдено.")
    return entry


def _entry_snapshot[T: (SeizureType, KetoneMethodDict)](entry: T) -> dict[str, Any]:
    return {"name_ru": entry.name_ru, "sort": entry.sort}


async def create_dictionary_entry[T: (SeizureType, KetoneMethodDict)](
    session: AsyncSession,
    model: type[T],
    *,
    payload: DictionaryEntryCreate,
    actor: CurrentUser,
    ip: str | None,
) -> DictionaryEntryRead:
    entry = await dictionaries_repo.create(
        session, model, name_ru=payload.name_ru, sort=payload.sort
    )
    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action="create",
        entity=model.__tablename__,
        entity_id=entry.id,
        after=_entry_snapshot(entry),
        ip=ip,
    )
    return DictionaryEntryRead.model_validate(entry)


async def update_dictionary_entry[T: (SeizureType, KetoneMethodDict)](
    session: AsyncSession,
    model: type[T],
    *,
    entry_id: uuid.UUID,
    payload: DictionaryEntryUpdate,
    actor: CurrentUser,
    ip: str | None,
) -> DictionaryEntryRead:
    entry = await _entry_or_404(session, model, entry_id)
    before = _entry_snapshot(entry)

    updated = await dictionaries_repo.update(
        session,
        entry=entry,
        name_ru=payload.name_ru if payload.name_ru is not None else entry.name_ru,
        sort=payload.sort if payload.sort is not None else entry.sort,
    )

    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action="update",
        entity=model.__tablename__,
        entity_id=updated.id,
        before=before,
        after=_entry_snapshot(updated),
        ip=ip,
    )
    return DictionaryEntryRead.model_validate(updated)


async def delete_dictionary_entry[T: (SeizureType, KetoneMethodDict)](
    session: AsyncSession,
    model: type[T],
    *,
    entry_id: uuid.UUID,
    actor: CurrentUser,
    ip: str | None,
) -> None:
    entry = await _entry_or_404(session, model, entry_id)

    references = await dictionaries_repo.count_references(session, model, entry_id)
    if references:
        # Дневниковая запись ссылается на значение внешним ключом. Удалить его —
        # значит оставить запись о приступе без типа: в истории и в отчёте врача
        # она перестанет читаться, а восстановить утраченное название будет неоткуда.
        raise ApiError(
            ErrorCode.CONFLICT,
            "Значение используется в записях дневника и не может быть удалено. "
            "Переименуйте его или заведите новое.",
            details={"references": references},
        )

    before = _entry_snapshot(entry)
    await dictionaries_repo.delete(session, entry=entry)

    await audit_repo.write_audit_log(
        session,
        user_id=actor.id,
        action="delete",
        entity=model.__tablename__,
        entity_id=entry_id,
        before=before,
        ip=ip,
    )
