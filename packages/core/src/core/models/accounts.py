"""Учётные записи и связи (раздел 4.2 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, ForeignKey, Index, Numeric, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import BIGINT, CITEXT, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, UpdatedAtMixin, UUIDPkMixin
from .enums import Sex, UserRole, pg_enum


class User(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "users"

    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(CITEXT, unique=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Момент последней смены пароля. Раздел 11 ТЗ требует ревокации сессий при
    # смене пароля, а refresh-токены у нас без состояния: хранилища выданных
    # токенов нет. Отметка попадает в токен claim'ом, и токен, выданный до
    # смены, отвергается — так revoke работает без таблицы сессий.
    password_changed_at: Mapped[datetime | None]
    totp_secret: Mapped[str | None] = mapped_column(String(64))
    # Секрет-кандидат: заполняется на /auth/totp/setup и становится действующим
    # только после /auth/totp/verify с валидным кодом. Пока подтверждения не было,
    # действующий totp_secret не трогается — иначе один вызов setup мог бы
    # отобрать второй фактор у владельца учётной записи.
    totp_pending_secret: Mapped[str | None] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    @property
    def has_totp(self) -> bool:
        """Настроен ли второй фактор.

        Свойство, а не колонка: единственный источник — сам секрет, и вторая
        запись того же факта однажды разошлась бы с ним. Наружу уходит только
        этот признак, сам секрет — никогда.
        """

        return self.totp_secret is not None

    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )
    last_login_at: Mapped[datetime | None]


class UserBackupCode(Base, UUIDPkMixin, CreatedAtMixin):
    """Резервный код входа: второй фактор, когда телефона с приложением нет.

    Без них потерянный телефон означал потерю учётной записи навсегда: отключить
    второй фактор нельзя (раздел 7 ТЗ требует его для admin/doctor/dietitian), а
    сброса не было ни у кого. Для клинической системы, где врач должен попасть в
    данные ребёнка сейчас, а не завтра, это неприемлемо.

    Практика — NIST SP 800-63B, §5.1.2 (look-up secrets): набор одноразовых
    кодов, выдаваемых один раз при включении второго фактора.

    Хранится sha256, а не argon2: код — случайные 50+ бит из узкого алфавита, и
    перебор по хэшу бессмыслен, а проверка при входе идёт против всех
    неиспользованных кодов сразу — десять argon2-проверок на каждый вход стоили
    бы секунду. Тот же довод, что у секрета привязки Telegram (ADR-0009).

    Строка не удаляется после использования: `used_at` — след того, что код
    сработал, и он нужен и журналу, и владельцу учётной записи.
    """

    __tablename__ = "user_backup_codes"
    __table_args__ = (
        UniqueConstraint("user_id", "code_hash", name="uq_user_backup_code"),
        Index("ix_user_backup_codes_user_id", "user_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    used_at: Mapped[datetime | None]


class Patient(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "patients"

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    birth_date: Mapped[date] = mapped_column(Date, nullable=False)
    sex: Mapped[Sex] = mapped_column(pg_enum(Sex, "patient_sex"), nullable=False)
    height_cm: Mapped[float | None] = mapped_column(Numeric(5, 1))
    allergies: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    notes: Mapped[str | None]


class ParentPatient(Base, UUIDPkMixin, CreatedAtMixin):
    __tablename__ = "parent_patient"
    __table_args__ = (UniqueConstraint("parent_id", "patient_id", name="uq_parent_patient"),)

    parent_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )


class DoctorPatient(Base, UUIDPkMixin, CreatedAtMixin):
    __tablename__ = "doctor_patient"
    __table_args__ = (UniqueConstraint("doctor_id", "patient_id", name="uq_doctor_patient"),)

    doctor_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )


class Invitation(Base, UUIDPkMixin, CreatedAtMixin):
    __tablename__ = "invitations"

    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    accepted_at: Mapped[datetime | None]
    # Кто пригласил. Раздел 4.2 задаёт `invited_by` у пользователя, но заполнить
    # его при принятии приглашения было нечем: сама заявка автора не хранила.
    # А для семьи это не просто след — пригласивший специалист становится ведущим
    # для её ребёнка (ADR-0003).
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )


class TelegramAccount(Base, UUIDPkMixin):
    """Привязка Telegram-чата к паре «родитель + ребёнок» ([ADR-0009](../../../../../docs/adr/0009-telegram-bot-authentication.md)).

    `chat_id` уникален не глобально, а среди живых привязок: частичный индекс
    `WHERE revoked_at IS NULL`. Глобальная уникальность делала повторную привязку
    того же чата после отзыва невозможной как новую строку — оставалось затирать
    существующую, теряя, кому и к какому ребёнку чат принадлежал раньше. Для
    клинической системы это потеря журнала (правило 4 в духе), а заодно и способ
    угнать чужую привязку: `UPDATE ... WHERE chat_id = ...` не спрашивает, чья
    строка обновляется.
    """

    __tablename__ = "telegram_accounts"
    __table_args__ = (
        Index(
            "uq_telegram_accounts_active_chat",
            "chat_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
        Index("ix_telegram_accounts_parent_id", "parent_id"),
        Index("ix_telegram_accounts_patient_id", "patient_id"),
    )

    parent_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    chat_id: Mapped[int] = mapped_column(BIGINT, nullable=False)
    # Второй фактор доступа бота. Сам секрет отдаётся боту один раз при привязке и
    # хранится у бота; в БД — только sha256. Сервисного токена из окружения
    # недостаточно: он открывает лишь привязку и обмен, но ни одной ручки с
    # данными пациента (ADR-0009).
    secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    linked_at: Mapped[datetime] = mapped_column(nullable=False)
    revoked_at: Mapped[datetime | None]


class LinkCode(Base):
    """PK — сам код (8 символов), а не отдельный uuid id: раздел 4.2 ТЗ описывает поле
    `code` первым и без `id`, в отличие от всех остальных таблиц раздела."""

    __tablename__ = "link_codes"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    parent_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    used_at: Mapped[datetime | None]
