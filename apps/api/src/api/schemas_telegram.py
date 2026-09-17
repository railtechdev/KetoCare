"""Схемы привязки Telegram (раздел 7.1 ТЗ, ADR-0009)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class LinkVerified(BaseModel):
    """Ответ боту после успешной привязки по коду доступа (ADR-0040).

    `secret` отдаётся ровно один раз — в БД лежит только его sha256. Потерявший
    секрет бот не сможет восстановить его иначе, чем через новую привязку, и это
    намеренно: восстановление по сервисному токену вернуло бы нас к одному фактору.
    """

    link_id: uuid.UUID
    patient_id: uuid.UUID
    # Имя ребёнка нужно боту для приветствия (раздел 7.1 ТЗ).
    patient_name: str
    secret: str
    #: Адрес веб-кабинета и есть ли туда вход. Нужны боту для приветствия:
    #: после привязки родитель обязан узнать, что кабинет существует и как его
    #: включить, — иначе «Готово, чат привязан» оставляло его в боте навсегда.
    #: У бота своей переменной с адресом нет и не будет: адрес знает сервер.
    web_url: str
    has_web_credentials: bool


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
    #: Адрес веб-кабинета (`WEB_ORIGIN`). Приходит с сервера, а не из своей
    #: переменной сборки: у Mini App её никогда не было, и оттого пустое
    #: состояние вкладки «Меню» отправляло в кабинет, не давая туда пути.
    web_url: str
    #: Заведён ли у родителя вход по почте. `false` — у учётной записи из
    #: Telegram (ADR-0040): ей показывается «Вход в кабинет», остальным нет.
    #: Признак приходит с сервера, потому что решает его ручка: экран, гадающий
    #: сам, однажды предложил бы то, что кончится отказом 409.
    has_web_credentials: bool


class TelegramLinkRead(BaseModel):
    """Привязка в кабинете: кто и когда привязал, отозвана ли."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    parent_id: uuid.UUID
    chat_id: int
    linked_at: datetime
    revoked_at: datetime | None
