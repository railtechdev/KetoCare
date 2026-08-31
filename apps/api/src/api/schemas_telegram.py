"""Схемы привязки Telegram (раздел 7.1 ТЗ, ADR-0009)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class LinkCodeCreated(BaseModel):
    """Код привязки. Показывается родителю один раз и живёт 15 минут."""

    code: str
    expires_at: datetime
    # Готовая ссылка `https://t.me/<bot>?start=<код>`: родителю с телефона проще
    # нажать, чем переписывать код. Собирается на сервере, потому что имя бота
    # знает только он (BOT_USERNAME). Пусто, если имя бота не настроено — тогда
    # кабинет показывает сам код.
    deep_link: str | None = None


class LinkCodeVerify(BaseModel):
    """Что присылает бот, получив `/start <код>`."""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=8)
    chat_id: int


class LinkVerified(BaseModel):
    """Ответ боту после успешной привязки.

    `secret` отдаётся ровно один раз — в БД лежит только его sha256. Потерявший
    секрет бот не сможет восстановить его иначе, чем через новую привязку, и это
    намеренно: восстановление по сервисному токену вернуло бы нас к одному фактору.
    """

    link_id: uuid.UUID
    patient_id: uuid.UUID
    # Имя ребёнка нужно боту для приветствия (раздел 7.1 ТЗ).
    patient_name: str
    secret: str


class BotSessionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    link_id: uuid.UUID
    secret: str = Field(min_length=1, max_length=256)


class BotSession(BaseModel):
    """Краткоживущий access-токен, суженный до одного ребёнка.

    Refresh-токена нет намеренно: бот в любой момент может обменять секрет
    привязки на новый access, а refresh пришлось бы где-то хранить и отзывать.
    Заодно это закрывает превращение временного доступа к чату в постоянную
    сессию родителя.
    """

    access_token: str
    expires_in: int
    patient_id: uuid.UUID


class MiniAppInitRequest(BaseModel):
    """Строка `initData`, которую Telegram отдаёт приложению при запуске.

    Передаётся как есть, без разбора на клиенте: подпись считается по всей
    строке целиком, и любая пересборка на клиенте её ломает.
    """

    model_config = ConfigDict(extra="forbid")

    init_data: str = Field(min_length=1, max_length=4096)


class MiniAppSession(BaseModel):
    """Сессия Mini App: пара токенов и ребёнок, к которому она сужена.

    Токены — в теле, а не в cookie: Mini App живёт во встроенном браузере
    Telegram, где сторонние cookie не выживают (раздел 5.2 ТЗ — «для Mini App
    заголовок»).
    """

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    patient_id: uuid.UUID
    patient_name: str


class TelegramLinkRead(BaseModel):
    """Привязка в кабинете: кто и когда привязал, отозвана ли."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    parent_id: uuid.UUID
    chat_id: int
    linked_at: datetime
    revoked_at: datetime | None
