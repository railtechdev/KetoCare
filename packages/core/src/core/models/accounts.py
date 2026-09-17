"""Учётные записи и связи (раздел 4.2 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import BIGINT, CITEXT, JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, UpdatedAtMixin, UUIDPkMixin
from .enums import Sex, UserRole, pg_enum


class User(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    __tablename__ = "users"

    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Почта и пароль — вход в веб-кабинет, а не удостоверение личности. Родитель
    # приходит из Telegram: его удостоверяет `telegram_user_id`, и требовать
    # почту значило бы либо выдумывать её за него, либо закрывать ему вход
    # (ADR-0040, этап Б). У сотрудника вход только один, и пустые колонки у него
    # запрещены ограничением `users_staff_have_credentials` — забытая проверка в
    # коде иначе однажды заведёт врача, которому нечем войти.
    #
    # Единственности почты `unique=True` здесь не задаёт: частичный индекс
    # `WHERE email IS NOT NULL` живёт в миграции — обычный UNIQUE в PostgreSQL
    # пропускает сколько угодно NULL, но выразить частичность в модели нечем.
    email: Mapped[str | None] = mapped_column(CITEXT)
    phone: Mapped[str | None] = mapped_column(String(32))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # Кто это в Telegram. Не chat_id: чатов у человека бывает несколько
    # (`telegram_links` привязывает чат к ребёнку), а учётная запись одна.
    telegram_user_id: Mapped[int | None] = mapped_column(BIGINT)
    # Момент последней смены пароля. Раздел 11 ТЗ требует ревокации сессий при
    # смене пароля, а refresh-токены у нас без состояния: хранилища выданных
    # токенов нет. Отметка попадает в токен claim'ом, и токен, выданный до
    # смены, отвергается — так revoke работает без таблицы сессий.
    password_changed_at: Mapped[datetime | None]
    # Пароль выдан администратором и должен быть заменён при первом входе.
    #
    # Временный пароль администратор передаёт голосом или в переписке, то есть
    # он заведомо известен второму человеку. Без этого признака он оставался бы
    # действующим сколько угодно долго, и администратор знал бы пароль врача.
    password_change_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    totp_secret: Mapped[str | None] = mapped_column(String(64))
    # Секрет-кандидат: заполняется на /auth/totp/setup и становится действующим
    # только после /auth/totp/verify с валидным кодом. Пока подтверждения не было,
    # действующий totp_secret не трогается — иначе один вызов setup мог бы
    # отобрать второй фактор у владельца учётной записи.
    totp_pending_secret: Mapped[str | None] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    @property
    def has_web_credentials(self) -> bool:
        """Заведён ли вход в веб-кабинет (ADR-0040, этап Б).

        «Хоть что-то заполнено», а не «заполнено и то, и другое»: тот же
        предикат, что у отказа `POST /users/me/credentials`. Два разных
        предиката однажды показали бы родителю панель «Вход в кабинет», которая
        кончается отказом 409.
        """

        return self.email is not None or self.password_hash is not None

    @property
    def totp_enrolled(self) -> bool:
        """Второй фактор ВКЛЮЧАЛСЯ — секрет когда-то записан (пусть и испорчен).

        Отличать включённость от пригодности приходится потому, что значение
        попадает в базу мимо приложения (сид, ручная правка, миграция), и
        пустая строка означает «фактор включён, но сломан». Пускать такого
        человека одним паролем — снятие второго фактора; требовать код —
        вечный тупик. Ответ на оба случая один: принудительная перенастройка.
        """

        return self.totp_secret is not None

    @property
    def totp_resettable(self) -> bool:
        """Есть что сбрасывать: подтверждённый секрет или начатая настройка.

        Вопрос карточки администратора и единственное условие сброса. Он шире
        включённости намеренно: застрявший на полпути настройки тоже приходит за
        сбросом, а испорченный секрет виден администратору именно здесь — по
        пригодности кнопка пропадала бы ровно у того, кому сброс и нужен.
        """

        return self.totp_secret is not None or self.totp_pending_secret is not None

    invited_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )
    last_login_at: Mapped[datetime | None]

    __table_args__ = (
        Index("uq_users_email", "email", unique=True, postgresql_where=text("email IS NOT NULL")),
        Index(
            "uq_users_telegram_user_id",
            "telegram_user_id",
            unique=True,
            postgresql_where=text("telegram_user_id IS NOT NULL"),
        ),
        # Учётная запись без почты и пароля бывает только у родителя, пришедшего
        # из Telegram. Сотрудник без пароля не вошёл бы никогда, а обнаружилось бы
        # это на приёме: проверка стоит в схеме, потому что учётные записи
        # заводятся не одним путём (приглашение, код доступа, сид, `create_admin`).
        CheckConstraint(
            "role = 'parent' OR (email IS NOT NULL AND password_hash IS NOT NULL)",
            name="users_staff_have_credentials",
        ),
    )


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
    #: Приглашение отозвано и больше не действует.
    #:
    #: Строка не удаляется: по ней видно, кого звали и кто звал, а ссылка
    #: показывается один раз и не восстанавливается — отозвать её было нечем.
    #: Ошибка в адресе означала действующее приглашение в чужой почтовый ящик,
    #: и единственным выходом было ждать, пока оно истечёт.
    revoked_at: Mapped[datetime | None]
    # Кто пригласил. Раздел 4.2 задаёт `invited_by` у пользователя, но заполнить
    # его при принятии приглашения было нечем: сама заявка автора не хранила.
    # А для семьи это не просто след — пригласивший специалист становится ведущим
    # для её ребёнка (ADR-0003).
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    #: К какому уже заведённому ребёнку зовут (ответ клиники на вопрос 33, ADR-0032).
    #:
    #: Пусто — приглашение сотрудника или первого родителя, который сам заведёт
    #: ребёнка (ADR-0003). Заполнено — второй родитель: при принятии он
    #: привязывается к этому ребёнку, а не заводит его второй карточкой.
    #:
    #: Имя `patient_id` не случайно: `core.tools.erase_patient` выводит таблицы
    #: пациента из метаданных по этой колонке, и приглашение с почтой второго
    #: родителя стирается вместе с ребёнком.
    patient_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=True, index=True
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


class ReminderSettings(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    """Когда напоминать семье (раздел 7.4 ТЗ).

    Одна строка на ребёнка: напоминания — про конкретного ребёнка, а не про
    родителя. У родителя двоих детей время замеров у них разное, и общая
    настройка означала бы напоминание не про того.

    Время — местное (`Settings.tz`), без часового пояса в колонке: семья
    называет «восемь вечера», а не момент UTC, и при переезде клиники в другой
    пояс правильным остаётся именно «восемь вечера».

    `None` у любого поля — этот вид напоминаний выключен. Выключено по
    умолчанию всё, кроме мягкого «за сегодня нет записей» в 20:00, — его ТЗ
    задаёт значением по умолчанию.
    """

    __tablename__ = "reminder_settings"
    __table_args__ = (Index("uq_reminder_settings_patient", "patient_id", unique=True),)

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    #: Выключатель на все напоминания разом: семье в больнице не до них.
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    ketones_at: Mapped[time | None]
    weight_at: Mapped[time | None]
    medications_at: Mapped[time | None]
    #: «За сегодня нет записей» — одно, мягкое (раздел 7.4 ТЗ).
    no_records_at: Mapped[time | None]

    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )


class ReminderDelivery(Base, UUIDPkMixin):
    """Что уже отправлено — чтобы не отправить дважды.

    Задача воркера идёт каждые пять минут, а окно попадания шире одного тика:
    без следа об отправке одно напоминание уходило бы несколько раз подряд.
    Уникальность по (ребёнок, вид, дата) делает повтор невозможным на уровне
    базы, а не на уровне аккуратности кода.
    """

    __tablename__ = "reminder_deliveries"
    __table_args__ = (
        Index("uq_reminder_delivery_day", "patient_id", "kind", "sent_on", unique=True),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    #: ketones | weight | medications | no_records | prescription
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    #: Местная дата семьи, а не UTC: «сегодня» у неё своё.
    sent_on: Mapped[date] = mapped_column(nullable=False)
    sent_at: Mapped[datetime] = mapped_column(nullable=False)
    chat_id: Mapped[int] = mapped_column(BIGINT, nullable=False)


class AccessCode(Base, CreatedAtMixin):
    """Код доступа семьи к ребёнку (ADR-0040).

    PK — сам код, как у `link_codes`: код и есть ключ, второго идентификатора у
    него нет. Один вид кода на все случаи — первый родитель, второй родитель,
    ещё один чат: два вида кодов семья и бот различать не должны.

    Хранится **в открытом виде**, в отличие от токена приглашения, который лежит
    хэшем. Это не небрежность, а разница назначения: приглашение — длинная
    ссылка, которую показывают один раз, код — восемь знаков, которые диктуют
    вслух и переписывают с экрана врача. Показать его повторно обязано и само
    приложение: карта показывает журнал кодов, пока они действуют. Защищают его
    срок и отзыв, а не хранение.
    """

    __tablename__ = "access_codes"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True
    )
    #: Кто выдал: специалист (этап А плана) или родитель себе (этап Б).
    #: От роли выдавшего зависит срок жизни — см. `access_codes.create`.
    issued_by: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    used_at: Mapped[datetime | None]
    #: Учётная запись, которую код привязал или создал. Нужна журналу карты:
    #: «кто именно получил доступ», а не только «код погашен».
    used_by: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("users.id"))
    #: Отозван из карты. Отдельно от `used_at`: «передумали» и «воспользовались»
    #: — разные события, и в журнале они выглядят по-разному.
    revoked_at: Mapped[datetime | None]
