"""Enum-поля моделей (раздел 4.1 ТЗ: "Enum-поля — PostgreSQL enum-типы, определённые в packages/core")."""

from __future__ import annotations

import enum
from typing import TypeVar

from sqlalchemy import Enum as SAEnum

E = TypeVar("E", bound=enum.Enum)


def pg_enum(enum_cls: type[E], name: str) -> SAEnum:
    return SAEnum(enum_cls, name=name, values_callable=lambda cls: [member.value for member in cls])


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    DOCTOR = "doctor"
    DIETITIAN = "dietitian"
    PARENT = "parent"


class Sex(str, enum.Enum):
    M = "m"
    F = "f"


class DiarySource(str, enum.Enum):
    WEB = "web"
    BOT = "bot"
    MINIAPP = "miniapp"
    AI_PARSED = "ai_parsed"


class RecipeCategory(str, enum.Enum):
    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    DINNER = "dinner"
    SNACK = "snack"
    DESSERT = "dessert"
    DRINK = "drink"


class RecipeStatus(str, enum.Enum):
    DRAFT = "draft"
    REVIEWED = "reviewed"
    PUBLISHED = "published"


class MealSlot(str, enum.Enum):
    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    DINNER = "dinner"
    SNACK = "snack"


class KetoneMethod(str, enum.Enum):
    BLOOD = "blood"
    URINE = "urine"


class AiJobKind(str, enum.Enum):
    ASSISTANT = "assistant"
    PARSE_MEAL = "parse_meal"
    PARSE_EVENT = "parse_event"
    DOCTOR_SUMMARY = "doctor_summary"
    CONTENT_DRAFT = "content_draft"


class AiJobStatus(str, enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class AiConversationChannel(str, enum.Enum):
    WEB = "web"
    MINIAPP = "miniapp"
