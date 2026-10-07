"""Коды доступа семьи к ребёнку (ADR-0040).

Отдельный модуль, а не строки в `schemas.py`: у кодов своя тема — выдача доступа
семье — и своих схем пять. `schemas.py` и без того на тысячу строк.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core.languages import Language
from core.models.enums import AccessCodePurpose

from .schemas import NewPassword

#: Статус считается на чтении, как у приглашений: хранить его отдельной колонкой
#: значит однажды разойтись с `used_at`/`revoked_at`/`expires_at`.
AccessCodeStatus = Literal["pending", "used", "expired", "revoked"]


class AccessCodeIssue(BaseModel):
    """Тело выпуска кода (ADR-0042). Необязательно целиком.

    Назначение не указано — берётся то, что выпускала роль до появления выбора:
    специалист открывает доступ другому взрослому, родитель подключает свой
    чат. Так прежние клиенты (раздел «Telegram» у семьи) работают без правок.
    """

    model_config = ConfigDict(extra="forbid")

    purpose: AccessCodePurpose | None = None


class AccessCodeCreated(BaseModel):
    """Ответ на выпуск: то, что показывают человеку на экране.

    Код приходит открытым текстом — в отличие от токена приглашения он для того
    и сделан, чтобы его прочитали вслух и переписали (ADR-0040).
    """

    code: str
    expires_at: datetime
    #: `https://t.me/<бот>?start=<код>` — путь семьи через Telegram. Пусто
    #: только там, где не задан `BOT_USERNAME`: имя бота знает сервер, и
    #: собрать ссылку больше неоткуда.
    deep_link: str | None = None
    #: Адрес веб-активации: `${WEB_ORIGIN}/join?code=…`. Нужен и сам по себе, и
    #: как запасной QR там, где бота нет.
    join_url: str


class AccessCodeRead(BaseModel):
    """Строка журнала кодов в карте ребёнка."""

    #: Пусто у чужого кода своего чата (ADR-0042): по нему чат привязывается к
    #: учётной записи выдавшего, и второй взрослый, прочитав код в журнале, вёл
    #: бы дневник от имени первого родителя. Строка остаётся — журнал говорит,
    #: что код был, но не отдаёт сам код.
    code: str | None
    status: AccessCodeStatus
    expires_at: datetime
    created_at: datetime
    used_at: datetime | None = None
    revoked_at: datetime | None = None
    #: Свой чат выдавшего или доступ другому взрослому: в журнале это разные
    #: события, и второе — выдача доступа к данным ребёнка.
    purpose: AccessCodePurpose
    #: Имя того, кто выдал, и того, кому достался доступ. Именами, а не
    #: идентификаторами: журнал читает человек, и вопрос у него — «кто».
    issued_by_name: str | None = None
    used_by_name: str | None = None
    #: Ссылки живого кода — те же, что при выдаче. Только у кода, который ещё
    #: можно погасить и который читающему виден: по ним Mini App показывает
    #: уже выданное приглашение близкому, а не выпускает новый код на каждое
    #: нажатие «Пригласить» (каждый — ещё одна действующая неделю дверь к
    #: данным ребёнка). Потребитель — `FamilyBlock` Mini App.
    deep_link: str | None = None
    join_url: str | None = None


class AccessCodeActivate(BaseModel):
    """Активация кода незнакомым системе человеком: заводится учётная запись.

    Поля те же, что у принятия приглашения, — и правила те же: иначе семья,
    пришедшая двумя разными путями, столкнулась бы с разными требованиями к
    паролю.
    """

    code: str = Field(min_length=1, max_length=16)
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    password: NewPassword
    phone: str | None = Field(default=None, max_length=32)


class AccessCodeClaim(BaseModel):
    """Активация кода человеком, который уже вошёл: добавляется ещё один ребёнок."""

    code: str = Field(min_length=1, max_length=16)


class AccessCodeClaimed(BaseModel):
    """Что получилось: к какому ребёнку появился доступ."""

    patient_id: uuid.UUID
    patient_name: str


class AccessCodeTelegramActivate(BaseModel):
    """Что присылает бот, получив `/start <код>` (ADR-0040, этап Б).

    Человека опознаёт `telegram_user_id`, а не `chat_id`: в личном чате они
    совпадают, но чатов у человека бывает несколько, и учётную запись надо
    находить по нему самому, а не по одному из его чатов.

    Имя приходит от Telegram и идёт в `full_name` новой учётной записи —
    спрашивать его отдельным шагом там, где оно уже известно, значит ставить
    семье лишнюю дверь на пути, который и затевался ради её отсутствия.
    """

    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=16)
    chat_id: int
    telegram_user_id: int
    first_name: str = Field(min_length=1, max_length=128)
    last_name: str | None = Field(default=None, max_length=128)
    #: Язык, на котором бот уже говорит с человеком: выбранный кнопкой до
    #: привязки или взятый из Telegram (ADR-0052). Сервер сохраняет его, только
    #: если у учётной записи языка ещё нет, — выбор, сделанный раньше в Mini App,
    #: не перетирается. Необязателен: бот до ADR-0052 его не присылает.
    language: Language | None = None
