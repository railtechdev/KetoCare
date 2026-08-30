"""Схемы заявок с посадочной страницы (ADR-0012)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core.models.enums import LeadAudience


class LeadCreate(BaseModel):
    """Тело формы. Полей ровно три, и ни одно не медицинское.

    `company` — приманка для спам-ботов: в форме это скрытое поле, которого
    человек не видит. Оно объявлено здесь, чтобы pydantic не отверг запрос
    из-за лишнего ключа, а решение по нему принимает сервис.
    """

    email: EmailStr
    audience: LeadAudience
    #: Язык страницы: `ru`, `uz-Latn-UZ`, `en` — как в атрибуте `lang`.
    locale: str = Field(default="ru", max_length=16)
    company: str | None = Field(default=None, max_length=200)


class LeadRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    audience: LeadAudience
    locale: str
    created_at: datetime
