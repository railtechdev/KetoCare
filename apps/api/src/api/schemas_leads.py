"""Схемы заявок с посадочной страницы (ADR-0012)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core.models.enums import LeadAudience

#: Языки сайта — ровно те, что отдаёт лендинг в атрибуте `lang`. Перечислением,
#: а не «строка до 16 символов»: поле приходит из открытой формы, и произвольный
#: текст в нём — это мусор в базе, который потом никто не разберёт.
LeadLocale = Literal["ru", "uz-Latn-UZ", "en"]


class LeadCreate(BaseModel):
    """Тело формы. Полей ровно три, и ни одно не медицинское.

    `website` — приманка для спам-ботов: в форме это скрытое поле, которого
    человек не видит. Оно объявлено здесь, чтобы pydantic не отверг запрос
    из-за лишнего ключа, а решение по нему принимает роутер.

    Имя не `company` намеренно: менеджеры паролей и автозаполнение браузеров
    охотно подставляют организацию даже в скрытое поле, и живой посетитель
    молча терял бы заявку, видя «Записали!».
    """

    email: EmailStr
    audience: LeadAudience
    #: Язык страницы, с которой пришла заявка.
    locale: LeadLocale = "ru"
    website: str | None = Field(default=None, max_length=200)


class LeadRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    audience: LeadAudience
    locale: str
    created_at: datetime
