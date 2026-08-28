"""Логика админских ручек: учётные записи, справочники, журнал аудита (раздел 5.3 ТЗ).

Здесь живёт всё, что не сводится к «прочитать и отдать»: запреты, ведущие к
потере администратора, проверка ссылок перед удалением значения справочника и
сокрытие клинической нагрузки в журнале.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.models import AuditLog, KetoneMethodDict, SeizureType, User
from core.repositories import audit as audit_repo
from core.repositories import dictionaries as dictionaries_repo
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
