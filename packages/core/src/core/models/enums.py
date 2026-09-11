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


class LeadAudience(enum.StrEnum):
    """Кому адресована заявка с посадочной страницы (ADR-0012).

    Формы две и ведут они к разным разговорам: семье нужно объяснить, что
    доступ открывает лечащий врач, клинике — показать кабинет и обсудить пилот.
    """

    FAMILY = "family"
    DOCTOR = "doctor"


class ReportFormat(enum.StrEnum):
    PDF = "pdf"
    CSV = "csv"


class ReportJobStatus(enum.StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class AttachmentOwnerKind(enum.StrEnum):
    """Кому принадлежит файл (ADR-0004: одна подсистема на два владельца).

    Разные контуры доступа: вложение пациента — клинические данные и проходит
    `require_patient_access`, фото рецепта клиническими данными не является.
    """

    RECIPE = "recipe"
    PATIENT = "patient"


class AttachmentDocKind(enum.StrEnum):
    """Вид документа пациента (решение заказчика, ADR-0013).

    Без него врач получал список файлов, различимых только по имени, которое дал
    телефон родителя. Значения покрывают сценарии из ADR-0004 плюс «иное»:
    справочник закрытый, потому что от вида зависит сортировка карты, а
    свободный ввод превратил бы её в набор синонимов.
    """

    DISCHARGE = "discharge"
    EEG = "eeg"
    #: Снимки: МРТ и КТ одним видом.
    #:
    #: Просила заказчица («МРТ добавить» на снимке формы). Вместе с КТ, а не
    #: отдельно: их кладут в один ряд и смотрят вместе, а заводить второе
    #: значение позже — вторая миграция ради одного слова.
    IMAGING = "imaging"
    LAB = "lab"
    PRESCRIPTION = "prescription"
    OTHER = "other"


class LeadingMacro(enum.StrEnum):
    """Ведущий макронутриент продукта — по КАЛОРИЯМ, а не по граммам.

    Заказчица просила три списка: «богатые белками, жирами, углеводами — чтобы
    заменить один продукт другим». Порога «богатый белками» ни в одном нашем
    источнике нет, и придумывать его нельзя (правило 1 CLAUDE.md). Поэтому не
    порог, а сравнение: на что из трёх приходится больше всего калорий
    (коэффициенты 9/4/4 — из `keto_engine.constants`).

    Правило воспроизводимо и объяснимо одной строкой, но оно НАШЕ, а не
    клиники — вопрос 50 медкоманде.

    Ведущий — строго больший. Продукт, у которого двое делят первое место, и
    продукт без калорий вовсе (вода, соль) ни в один из трёх списков не
    попадают: назвать у них ведущий макронутриент значило бы выбрать за них.
    Перечисления «ничьей» здесь нет намеренно — это не свойство продукта, а
    отсутствие свойства.
    """

    FAT = "fat"
    PROTEIN = "protein"
    CARBS = "carbs"


class MedicationFrequency(enum.StrEnum):
    """Кратность приёма препарата — из списка, а не строкой (ADR-0033, вопрос 45).

    Клиника просила выбирать кратность из списка («одно и то же назначение,
    записанное по-разному»), а самого списка не прислала. Значения не придуманы:
    это коды кратности HL7 FHIR R4, набор `TimingAbbreviation`
    (http://hl7.org/fhir/ValueSet/timing-abbreviation, система
    v3-GTSAbbreviation): QD — раз в сутки, BID/TID/QID — два, три и четыре раза,
    QOD — через день.

    Из того же набора НЕ взяты коды времени суток (AM, PM, BED — «на ночь») и
    почасовые (Q4H и т. п.): для схемы противоэпилептических препаратов это
    уточнение к кратности, а не другая кратность, и пишется оно текстом рядом.

    «По требованию» в FHIR — не код кратности, а отдельный признак
    (`Dosage.asNeeded`). Здесь это значение того же списка: у препарата,
    купирующего приступ, расписания нет вовсе, и в форме выбор один.

    «Другая схема» — для того, что списком не описывается (титрование, «через
    два дня на третий»); уточнение у неё обязательно.

    Список провизорный — клиника может его поправить. Новое значение — миграция
    типа, переименование подписи — только словари.
    """

    ONCE_DAILY = "once_daily"
    TWICE_DAILY = "twice_daily"
    THREE_TIMES_DAILY = "three_times_daily"
    FOUR_TIMES_DAILY = "four_times_daily"
    EVERY_OTHER_DAY = "every_other_day"
    AS_NEEDED = "as_needed"
    OTHER = "other"
