"""Схемы админских ручек `/admin` (раздел 5.3 ТЗ).

Учётные записи читаются общей схемой `UserRead` из `schemas.py` — в ней нет ни
`password_hash`, ни `totp_secret`, ни связей с пациентами.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.models.enums import UserRole

from .schemas import RequiredName, UserRead

# Поля учётной записи, которые не могут стать null: в БД они NOT NULL.
_NOT_NULLABLE_USER_FIELDS = ("full_name", "role", "is_active")


class AdminUserRead(UserRead):
    """Учётная запись в списке администратора.

    Сверх обычного профиля — число пациентов, которых ведёт только этот
    специалист. Это не клинические данные (администратору они закрыты), а
    счётчик связей: без него отключение врача выглядело безобидной правкой
    доступа, а на деле оставляло его пациентов невидимыми для всех клиницистов.
    """

    sole_patients: int = 0


class RoleCount(BaseModel):
    role: UserRole
    active: int
    inactive: int


class AdminOverview(BaseModel):
    """Состояние системы для главной администратора.

    Клинических данных здесь нет по построению: счётчики учётных записей,
    справочника продуктов и приглашений. Считает их база — главная раньше
    пересчитывала первые двести строк списка на клиенте, и у клиники с сотней
    семей число на экране переставало быть правдой.
    """

    users: list[RoleCount]
    products_total: int
    products_active: int
    #: Позиции, у которых дата сверки с источником старше `stale_after_days`.
    products_stale: int
    stale_after_days: int
    #: Приглашения, по которым ещё не завели учётную запись.
    invitations_pending: int
    invitations_expired: int


class AdminUserUpdate(BaseModel):
    """PATCH: меняются только переданные поля.

    `phone` — единственное поле, которое можно осмысленно сбросить в null; для
    остальных явный `null` отвергается, иначе запрос вида `{"full_name": null}`
    упирался бы в NOT NULL уже в базе и возвращал 500 вместо понятной ошибки.
    """

    model_config = ConfigDict(extra="forbid")

    full_name: RequiredName | None = None
    phone: str | None = Field(default=None, max_length=32)
    role: UserRole | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def _check_changes(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Укажите хотя бы одно поле для изменения.")

        empty = [
            field
            for field in _NOT_NULLABLE_USER_FIELDS
            if field in self.model_fields_set and getattr(self, field) is None
        ]
        if empty:
            raise ValueError(f"Поля нельзя очистить: {', '.join(empty)}.")
        return self


class DictionaryEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name_ru: str
    sort: int


class SeizureTypeRead(DictionaryEntryRead):
    """Тип приступа с коротким кодом (ADR-0007).

    Отдельная схема, а не поле в `DictionaryEntryRead`: у методов измерения
    кетонов кода нет и быть не должно, а общая схема выдавала бы им пустое
    поле и предлагала его заполнить.
    """

    code: str | None


class DictionaryEntryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name_ru: RequiredName
    sort: Annotated[int, Field(ge=0, le=10_000)] = 0


class SeizureTypeCreate(DictionaryEntryCreate):
    """Тип приступа заводится вместе с коротким кодом (ADR-0007).

    Без кода месячная сетка дневника подставляет в клетку полное название, а в
    легенду тип не попадает вовсе — то есть новый тип, заведённый
    администратором, ломал ровно то, ради чего коды и вводились. Код
    необязателен: у части типов его может не быть (вопрос 4 медкоманде), и
    пустое значение честнее выдуманного.
    """

    # Длина — как у колонки `seizure_types.code` (String(4)): за ней СУБД
    # ответила бы ошибкой записи вместо понятного 422.
    code: Annotated[str, Field(min_length=1, max_length=4)] | None = None


class DictionaryEntryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name_ru: str | None = Field(default=None, min_length=1, max_length=255)
    sort: Annotated[int, Field(ge=0, le=10_000)] | None = None

    @model_validator(mode="after")
    def _check_changes(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Укажите хотя бы одно поле для изменения.")
        if any(
            getattr(self, field) is None
            for field in self.model_fields_set
            # `code` — единственное поле, которое очищают осознанно: тип может
            # остаться без короткого кода.
            if field != "code"
        ):
            raise ValueError("Поля справочника нельзя очистить.")
        return self


class SeizureTypeUpdate(DictionaryEntryUpdate):
    # Длина — как у колонки `seizure_types.code` (String(4)): за ней СУБД
    # ответила бы ошибкой записи вместо понятного 422.
    code: Annotated[str, Field(min_length=1, max_length=4)] | None = None


class AuditLogRead(BaseModel):
    """Запись журнала аудита.

    `before`/`after` отдаются не для всех сущностей: журнал общий, а админ к
    клиническим данным доступа не имеет (раздел 5.1 ТЗ). Скрытая нагрузка
    помечается `payload_hidden`, чтобы отсутствие данных не выглядело как
    отсутствие записи о них.

    Собирается только через `services.admin.audit_entry_to_schema`: `from_attributes`
    здесь намеренно нет, иначе `model_validate(строка_журнала)` отдал бы нагрузку
    в обход этой проверки.
    """

    id: uuid.UUID
    user_id: uuid.UUID | None
    action: str
    entity: str
    entity_id: uuid.UUID | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    payload_hidden: bool
    ip: str | None
    created_at: datetime
