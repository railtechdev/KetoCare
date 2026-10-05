"""Схемы привязки Telegram (раздел 7.1 ТЗ, ADR-0009)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from core.languages import Language


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
    #: Имя без фамилии — им бот называет ребёнка в переключателе и в эхе
    #: записей, когда чат ведёт двоих (ADR-0048). Отдельным полем, а не
    #: разбором `patient_name` в боте: правило «что считать именем» одно на
    #: бота и рассылки воркера.
    patient_first_name: str
    secret: str
    #: Адрес веб-кабинета и есть ли туда вход. Нужны боту для приветствия:
    #: после привязки родитель обязан узнать, что кабинет существует и как его
    #: включить, — иначе «Готово, чат привязан» оставляло его в боте навсегда.
    #: У бота своей переменной с адресом нет и не будет: адрес знает сервер.
    web_url: str
    has_web_credentials: bool
    #: Язык человека после привязки (ADR-0052): сохранённый раньше или только
    #: что принятый от бота. Бот говорит на нём, а не на своей догадке.
    language: Language


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
    #: Какого ребёнка открыть, если чат ведёт нескольких (ADR-0048). Пусто —
    #: первого привязанного. Ребёнок без живой привязки этого Telegram — 404 с
    #: причиной `child_not_linked`, а не тихая подмена другим ребёнком.
    patient_id: uuid.UUID | None = None


class MiniAppSwitchRequest(BaseModel):
    """Переключение Mini App на другого ребёнка того же чата (ADR-0048)."""

    model_config = ConfigDict(extra="forbid")

    patient_id: uuid.UUID


class MiniAppChild(BaseModel):
    """Ребёнок, которого ведёт этот Telegram: строка переключателя Mini App."""

    patient_id: uuid.UUID
    name: str


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
    #: Все дети, которых ведёт этот Telegram, включая открытого (ADR-0048).
    #: Переключатель в Mini App показывается, только когда их два и больше.
    children: list[MiniAppChild]
    #: Адрес веб-кабинета (`WEB_ORIGIN`). Приходит с сервера, а не из своей
    #: переменной сборки: у Mini App её никогда не было, и оттого пустое
    #: состояние вкладки «Меню» отправляло в кабинет, не давая туда пути.
    web_url: str
    #: Заведён ли у родителя вход по почте. `false` — у учётной записи из
    #: Telegram (ADR-0040): ей показывается «Вход в кабинет», остальным нет.
    #: Признак приходит с сервера, потому что решает его ручка: экран, гадающий
    #: сам, однажды предложил бы то, что кончится отказом 409.
    has_web_credentials: bool
    #: Язык интерфейса (ADR-0052): сохранённый у учётной записи, а если его
    #: не было — язык Telegram из подписи запуска, тут же сохранённый.
    language: Language


class TelegramLinkRead(BaseModel):
    """Привязка в кабинете: кто и когда привязал, отозвана ли."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    parent_id: uuid.UUID
    chat_id: int
    linked_at: datetime
    revoked_at: datetime | None
    #: Чей это чат — имя взрослого. Без него список у ребёнка был рядом «Чат
    #: 4242 / Чат 5151», и понять, какой из них бабушкин, было нельзя.
    parent_name: str | None = None
