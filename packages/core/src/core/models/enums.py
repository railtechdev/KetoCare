"""Enum-поля моделей (раздел 4.1 ТЗ: "Enum-поля — PostgreSQL enum-типы, определённые в packages/core")."""

from __future__ import annotations

import enum

from sqlalchemy import Enum as SAEnum


def pg_enum[E: enum.Enum](enum_cls: type[E], name: str) -> SAEnum:
    return SAEnum(enum_cls, name=name, values_callable=lambda cls: [member.value for member in cls])


class UserRole(enum.StrEnum):
    ADMIN = "admin"
    DOCTOR = "doctor"
    DIETITIAN = "dietitian"
    PARENT = "parent"


class Sex(enum.StrEnum):
    M = "m"
    F = "f"


class DiarySource(enum.StrEnum):
    WEB = "web"
    BOT = "bot"
    MINIAPP = "miniapp"
    AI_PARSED = "ai_parsed"


class RecipeCategory(enum.StrEnum):
    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    DINNER = "dinner"
    SNACK = "snack"
    DESSERT = "dessert"
    DRINK = "drink"


class RecipeStatus(enum.StrEnum):
    DRAFT = "draft"
    REVIEWED = "reviewed"
    PUBLISHED = "published"


class MealSlot(enum.StrEnum):
    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    DINNER = "dinner"
    SNACK = "snack"


class KetoneMethod(enum.StrEnum):
    BLOOD = "blood"
    URINE = "urine"


class AiJobKind(enum.StrEnum):
    ASSISTANT = "assistant"
    PARSE_MEAL = "parse_meal"
    PARSE_EVENT = "parse_event"
    DOCTOR_SUMMARY = "doctor_summary"
    CONTENT_DRAFT = "content_draft"


class AiJobStatus(enum.StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class AiConversationChannel(enum.StrEnum):
    WEB = "web"
    MINIAPP = "miniapp"


class IntakeScale(enum.StrEnum):
    """Шкалы анкеты регистрации (ADR-0007).

    Один справочник на пять шкал вместо пяти таблиц: устроены они одинаково и
    правятся одним экраном админки. Формулировки вариантов задаёт медицинская
    команда — вопросы 19-21 в docs/medical/OPEN_QUESTIONS.md.
    """

    ONSET_AGE = "onset_age"
    SEIZURE_FREQUENCY = "seizure_frequency"
    SEIZURE_DURATION = "seizure_duration"
    AED_SWITCH_COUNT = "aed_switch_count"
    MEALS_PER_DAY = "meals_per_day"


class ReportFormat(enum.StrEnum):
    PDF = "pdf"
    CSV = "csv"


class ReportJobStatus(enum.StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
