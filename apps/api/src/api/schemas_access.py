"""Коды доступа семьи к ребёнку (ADR-0040).

Отдельный модуль, а не строки в `schemas.py`: у кодов своя тема — выдача доступа
семье — и своих схем пять. `schemas.py` и без того на тысячу строк.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

#: Статус считается на чтении, как у приглашений: хранить его отдельной колонкой
#: значит однажды разойтись с `used_at`/`revoked_at`/`expires_at`.
AccessCodeStatus = Literal["pending", "used", "expired", "revoked"]


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

    code: str
    status: AccessCodeStatus
    expires_at: datetime
    created_at: datetime
    used_at: datetime | None = None
    revoked_at: datetime | None = None
    #: Имя того, кто выдал, и того, кому достался доступ. Именами, а не
    #: идентификаторами: журнал читает человек, и вопрос у него — «кто».
    issued_by_name: str | None = None
    used_by_name: str | None = None


class AccessCodeActivate(BaseModel):
    """Активация кода незнакомым системе человеком: заводится учётная запись.

    Поля те же, что у принятия приглашения, — и правила те же: иначе семья,
    пришедшая двумя разными путями, столкнулась бы с разными требованиями к
    паролю.
    """

    code: str = Field(min_length=1, max_length=16)
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=12, max_length=128)
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
