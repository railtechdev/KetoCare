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


# TODO(med): подтвердить список кратностей у медицинской команды — вопрос 45.
class MedicationFrequency(enum.StrEnum):
    """Кратность приёма препарата — из списка, а не строкой (ADR-0033, вопрос 45).

    Клиника просила выбирать кратность из списка («одно и то же назначение,
    записанное по-разному»), а самого списка не прислала. Значения не придуманы:
    это коды кратности HL7 FHIR R4, набор `TimingAbbreviation`
    (http://hl7.org/fhir/ValueSet/timing-abbreviation, система
    v3-GTSAbbreviation): QD — раз в сутки, BID/TID/QID — два, три и четыре раза,
    QOD — через день.

    Из того же набора НЕ взяты коды времени суток (AM, PM, BED — «на ночь»): для
    схемы противоэпилептических препаратов это уточнение к кратности, а не другая
    кратность, и пишется оно текстом рядом. Не взяты и почасовые: Q6H и Q8H — это
    4 и 3 раза в сутки с интервалом в уточнении, а Q1H–Q4H (от 6 до 24 приёмов в
    сутки) для постоянной схемы противоэпилептических препаратов обычно не
    применяются и при нужде записываются «другой схемой». Не взяты и недельный с месячным (WK, MO): противоэпилептические
    препараты так обычно не назначают, а пульсовые курсы гормонов записываются
    «другой схемой» со словами.

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


class MedicationDoseUnit(enum.StrEnum):
    """Единица разовой дозы препарата — из списка, а не строкой (ADR-0049, вопрос 44).

    Решение команды разработки по стандарту (заказчик, 05.10.2026: это вопрос
    ввода данных, а не клиники). Доза в HL7 FHIR R4 — `Dosage.doseAndRate.
    doseQuantity`, то есть количество с единицей UCUM; разовая, а кратность
    живёт отдельно (`MedicationFrequency`). Значения перечисления — наши, их
    соответствие кодам UCUM:

    - `mg` — mg, `g` — g, `mcg` — ug, `ml` — mL;
    - `iu` — [iU], международные единицы (гормоны, АКТГ, витамин D);
    - `drop` — [drp], капли;
    - `tablet`, `capsule`, `sachet` — штучные формы. В UCUM это аннотации
      (`{tbl}`), в FHIR их обычно кодируют формой выпуска; для врача это
      «0,5 табл.» — половина таблетки, и записать её иначе нельзя.

    `other` — всё, что одной единицей на приём не описывается: «2,5 мг/кг/сут»,
    титрование. Числа у неё нет, доза пишется словами, и слова обязательны.

    Нового значения — миграция типа, подпись — словари (сервер и кабинет,
    сверяет `test_medication_dose.py`).
    """

    MG = "mg"
    G = "g"
    MCG = "mcg"
    ML = "ml"
    IU = "iu"
    DROP = "drop"
    TABLET = "tablet"
    CAPSULE = "capsule"
    SACHET = "sachet"
    OTHER = "other"


class LastSeizurePrecision(enum.StrEnum):
    """Насколько точно семья помнит дату последнего приступа (ADR-0049, вопрос 48).

    Частичная дата по образцу FHIR (`date`: «2026», «2026-03», «2026-03-15»):
    дата хранится полной, первым днём своего месяца или года, а точность —
    рядом. Так дата остаётся датой (сравнивается, сортируется, проверяется на
    «не в будущем»), а неточная не притворяется точной — врач по ней судит о
    длительности ремиссии.

    `unknown` — «не помню»: тоже ответ, и он отличается от «не отвечено».
    """

    DAY = "day"
    MONTH = "month"
    YEAR = "year"
    UNKNOWN = "unknown"


class AccessCodePurpose(enum.StrEnum):
    """Зачем выпущен код доступа (ADR-0042).

    От назначения, а не от роли выдавшего, зависят срок жизни и то, кому код
    достанется. Пока назначение выводилось из роли, родитель не мог открыть
    доступ второму взрослому: любой его код считался «своим чатом».
    """

    #: Подключить к своей же учётной записи ещё один Telegram. Выпускает только
    #: родитель, живёт четверть часа, в вебе не действует.
    OWN_CHAT = "own_chat"
    #: Открыть карту ребёнка другому взрослому — новой или чужой учётной записи.
    #: Выпускают ведущий специалист и родитель, живёт неделю.
    FAMILY_MEMBER = "family_member"


class TherapyEndReason(enum.StrEnum):
    """Почему кетодиетотерапия завершена (ADR-0050, вопросы 18 и 52).

    Клиника ответила на вопрос 18 о сроках («эффективность определяется через 6
    месяцев… при эффективности пациент находится на ней минимум 2 года»), но
    перечня причин завершения не дала. Список ниже — провизорный, по разделу о
    прекращении диеты консенсуса International Ketogenic Diet Study Group
    (Kossoff et al., Epilepsia Open 2018;3(2):175-192): плановое завершение после
    эффективного курса, недостаточная эффективность, нежелательные явления,
    решение семьи. «Наблюдение передано в другую клинику» — причина не
    медицинская, а организационная. «Другое» требует пояснения.

    TODO(med): подтвердить у медицинской команды — вопрос 52 в
    docs/medical/OPEN_QUESTIONS.md. Новое значение — миграция типа,
    переименование подписи — только словари.
    """

    COURSE_COMPLETED = "course_completed"
    INEFFECTIVE = "ineffective"
    ADVERSE_EFFECTS = "adverse_effects"
    FAMILY_DECISION = "family_decision"
    TRANSFERRED = "transferred"
    OTHER = "other"
