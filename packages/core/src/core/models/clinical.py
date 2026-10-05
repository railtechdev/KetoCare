"""Клиника (раздел 4.2 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    event,
    false,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, SoftDeleteMixin, UpdatedAtMixin, UUIDPkMixin
from .enums import (
    IntakeScale,
    LastSeizurePrecision,
    MedicationDoseUnit,
    MedicationFrequency,
    TherapyEndReason,
    pg_enum,
)


class MedicalProfile(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin, SoftDeleteMixin):
    __tablename__ = "medical_profiles"

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), unique=True, nullable=False
    )
    diagnosis: Mapped[str | None]
    epilepsy_type: Mapped[str | None]
    onset_age_months: Mapped[int | None] = mapped_column(Integer)
    genetics: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB
    )  # {gene, variant, interpretation}
    comorbidities: Mapped[str | None]
    # Сколько противоэпилептических препаратов ребёнок сменил, диапазоном
    # (ADR-0007). Врачебное поле: семья путает названия и число попыток, а от
    # этого зависит, считается ли эпилепсия фармакорезистентной.
    aed_switch_count_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )
    #: Дата начала кетодиетотерапии — со слов врача.
    #:
    #: Ответ клиники от 09.09.2026 (вопрос 17): «В системе обязательно должно
    #: быть отдельное поле "Дата начала кетогенной диетотерапии"». От неё
    #: отсчитываются контрольные визиты (1, 3, 6, 9 и 12 месяцев) и по ней же
    #: решается, считать ли ответ семьи о частоте приступов исходным уровнем.
    #:
    #: Почему отдельным полем, а не выводом из первого назначения. Вывод и
    #: раньше был (`repositories.therapy.started_on` его сохраняет запасным
    #: вариантом), но он лжёт в двух обычных случаях: ребёнка перевели из другой
    #: клиники и завели в системе уже на диете — тогда первое НАШЕ назначение
    #: позже настоящего старта; и наоборот, назначение записали заранее, а диету
    #: начали не в тот день. Слово врача точнее вывода, и клиника попросила
    #: именно поле.
    #:
    #: В медицинском профиле, а не в `patients`: карточку ребёнка правит и
    #: семья (рост, аллергии, заметки), а дату начала терапии задаёт врач.
    #: Профиль пишет только он (`PUT /medical-profile`), читает ещё диетолог
    #: (ADR-0031).
    therapy_started_on: Mapped[date | None] = mapped_column(Date)
    #: Дата завершения кетодиетотерапии (вопрос 18, ADR-0050).
    #:
    #: Пусто — ребёнок на терапии. Заполнено — терапия завершена: ребёнок уходит
    #: из рабочих списков врача и из пометок «семья молчит», напоминания семье
    #: прекращаются, но карта, дневники и отчёты остаются читаемыми — клинические
    #: данные не удаляются (правило 4). Ставит и снимает только врач, отдельной
    #: ручкой с записью в журнал аудита: от этой даты зависит, кого система
    #: перестаёт сопровождать.
    #:
    #: В профиле, а не в `patients`: карточку ребёнка правит и семья, а решение
    #: о завершении — врачебное. Семья видит только сам факт и дату (сводка),
    #: причину — нет.
    therapy_ended_on: Mapped[date | None] = mapped_column(Date)
    #: Причина завершения — из закрытого провизорного списка (вопрос 52).
    therapy_end_reason: Mapped[TherapyEndReason | None] = mapped_column(
        pg_enum(TherapyEndReason, "therapy_end_reason")
    )
    #: Пояснение врача; обязательно при причине «другое».
    therapy_end_note: Mapped[str | None]

    __table_args__ = (
        # Дата и причина ставятся и снимаются вместе: завершение без причины —
        # это половина решения, а причина без даты — решение, которого не было.
        CheckConstraint(
            "(therapy_ended_on IS NULL) = (therapy_end_reason IS NULL)",
            name="therapy_end_has_reason",
        ),
    )


class ControlVisit(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin, SoftDeleteMixin):
    """Контрольная точка наблюдения: плановый визит к врачу (вопросы 17 и 34).

    Ответ клиники от 09.09.2026: «Контрольный визит через 1, 3, 6, 9 и 12 месяцев
    от старта диеты»; анализы — «можно сделать как напоминание пациенту».
    Визиты ХРАНЯТСЯ, а не выводятся из даты старта на лету: иначе всякий
    прошедший срок оставался бы «просроченным» навсегда — отметить, что визит
    состоялся, было бы негде (`completed_on`).

    `month_offset` — для точек, построенных по графику от даты начала терапии;
    у визита, назначенного врачом вручную, он пуст. Уникальность по
    (пациент, месяц) среди живых строк делает построение графика повторяемым:
    второй вызов не задваивает визиты.

    Значений анализов здесь нет намеренно: клиника назвала ввод показателей
    «время- и энергозатратным», а без границ нормы по возрасту число ничего бы
    не значило. Перечень анализов к визиту выводится из `month_offset`
    (`core.control_schedule`), а не хранится.
    """

    __tablename__ = "control_visits"
    __table_args__ = (
        Index(
            "uq_control_visits_patient_month",
            "patient_id",
            "month_offset",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND month_offset IS NOT NULL"),
        ),
        CheckConstraint(
            "month_offset IS NULL OR month_offset > 0", name="control_visit_month_positive"
        ),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False, index=True
    )
    planned_on: Mapped[date] = mapped_column(Date, nullable=False)
    month_offset: Mapped[int | None] = mapped_column(Integer)
    completed_on: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str | None]
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )


class Prescription(Base, UUIDPkMixin):
    """Append-only (правило 2, CLAUDE.md): изменение назначения — новая строка,
    UPDATE/DELETE запрещены на уровне репозитория."""

    __tablename__ = "prescriptions"

    # НЕ CreatedAtMixin: там server_default=now(), а now() в PostgreSQL — это время
    # НАЧАЛА ТРАНЗАКЦИИ, одинаковое для всех строк, вставленных в одной транзакции.
    # Активное назначение определяется как "последнее по created_at" (раздел 4.2 ТЗ),
    # то есть при совпадении меток порядок недетерминирован — а это ratio, по которому
    # семья кормит ребёнка. clock_timestamp() возвращает реальное время на момент
    # вставки строки и различается даже внутри одной транзакции.
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("clock_timestamp()"), nullable=False
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    ratio: Mapped[float] = mapped_column(Numeric(3, 1), nullable=False)
    kcal_per_day: Mapped[int] = mapped_column(Integer, nullable=False)
    protein_g: Mapped[float] = mapped_column(Numeric(6, 1), nullable=False)
    carbs_limit_g: Mapped[float] = mapped_column(Numeric(6, 1), nullable=False)
    meals_per_day: Mapped[int] = mapped_column(Integer, nullable=False)
    restrictions: Mapped[str | None]
    author_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    effective_from: Mapped[date] = mapped_column(nullable=False)


class AppendOnlyViolationError(RuntimeError):
    """Попытка изменить или удалить строку append-only таблицы."""


@event.listens_for(Prescription, "before_update", propagate=True)
def _forbid_prescription_update(_mapper: object, _connection: object, target: Prescription) -> None:
    raise AppendOnlyViolationError(
        "prescriptions — append-only (правило 4 CLAUDE.md): изменение назначения оформляется "
        "новой строкой через repositories.prescriptions.create(), а не UPDATE существующей."
    )


@event.listens_for(Prescription, "before_delete", propagate=True)
def _forbid_prescription_delete(_mapper: object, _connection: object, target: Prescription) -> None:
    raise AppendOnlyViolationError(
        "prescriptions — append-only (правило 4 CLAUDE.md): удаление назначений запрещено."
    )


class Medication(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin, SoftDeleteMixin):
    __tablename__ = "medications"
    __table_args__ = (
        # Кратность обязана быть описана: кодом из списка или словами. «Другая
        # схема» без слов не описывает ничего — по ней не понять, как давать
        # препарат.
        CheckConstraint(
            "(frequency_code IS NOT NULL AND frequency_code <> 'other') OR frequency IS NOT NULL",
            name="ck_medications_frequency_described",
        ),
        # Доза числом и единицей (ADR-0049): число есть ровно тогда, когда есть
        # единица, кроме «другой», у которой доза словами. CASE, а не OR: у
        # OR с NULL ответ NULL, и CHECK пропустил бы число без единицы.
        CheckConstraint(
            "CASE WHEN dose_unit IS NULL OR dose_unit = 'other' THEN dose_value IS NULL "
            "ELSE dose_value IS NOT NULL AND dose_value > 0 END",
            name="ck_medications_dose_quantity",
        ),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    drug_name: Mapped[str] = mapped_column(String(255), nullable=False)
    #: Доза так, как её читает человек: «300 мг», «0,5 табл.». Заполнена всегда.
    #:
    #: С ADR-0049 у новой записи её собирает сервер из числа и единицы
    #: (`services/medication_dose.describe_dose`), у «другой единицы» — это
    #: слова врача, у записей до списка — строка как была. Читают её отчёты,
    #: сводка врача, дневник и бот: им не нужно знать, как доза задана.
    dose: Mapped[str] = mapped_column(String(255), nullable=False)
    #: Разовая доза числом (FHIR `doseQuantity.value`). Пусто у записей до
    #: списка и у «другой единицы»: их строку в число без врача не перевести —
    #: «2,5 мг/кг/сут» не разовая доза, а «по 1/2 таб.» требует прочтения.
    dose_value: Mapped[float | None] = mapped_column(Numeric(10, 3))
    dose_unit: Mapped[MedicationDoseUnit | None] = mapped_column(
        pg_enum(MedicationDoseUnit, "medication_dose_unit")
    )
    # Кратность — кодом из списка (ADR-0033). Пусто только у записей, заведённых
    # до списка: их кратность осталась словами в `frequency`, и перевести её в
    # код без врача нельзя — «утром и на ночь» бывает и двумя приёмами, и одним
    # вечерним с утренней проверкой.
    frequency_code: Mapped[MedicationFrequency | None] = mapped_column(
        pg_enum(MedicationFrequency, "medication_frequency")
    )
    # Уточнение к кратности («утром и на ночь») — или вся кратность у записей
    # до списка.
    frequency: Mapped[str | None] = mapped_column(String(255))
    started_at: Mapped[date] = mapped_column(nullable=False)
    stopped_at: Mapped[date | None]
    author_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )


class ClinicalNote(Base, UUIDPkMixin, CreatedAtMixin, SoftDeleteMixin):
    __tablename__ = "clinical_notes"

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    text: Mapped[str] = mapped_column(nullable=False)


class IntakeOption(Base, UUIDPkMixin):
    """Вариант ответа шкалы анкеты регистрации (ADR-0007).

    Один справочник на все шкалы: вид шкалы задаёт `scale`. Формулировки —
    из документа заказчика; три шкалы из пяти к применению как есть непригодны
    (разрывы и пересечения), вопросы 19-21 в docs/medical/OPEN_QUESTIONS.md.
    Правятся админ-ручкой, а не миграцией: состав задаёт медицинская команда.
    """

    __tablename__ = "intake_options"
    __table_args__ = (UniqueConstraint("scale", "code", name="uq_intake_options_scale_code"),)

    scale: Mapped[IntakeScale] = mapped_column(pg_enum(IntakeScale, "intake_scale"), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name_ru: Mapped[str] = mapped_column(String(255), nullable=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Выведенный из употребления вариант: новым ответам не предлагается, но
    # остаётся в справочнике. Удалить его нельзя — на него ссылаются уже
    # заполненные анкеты, а ответ семьи не должен исчезать вместе со сменой
    # формулировки (правило 4 CLAUDE.md).
    retired: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )


class AedDrug(Base, UUIDPkMixin):
    """Противоприступный препарат, ASM (ADR-0007).

    Терминология — по ответу клиники от 09.09.2026 (вопрос 21): действующая
    международная — antiseizure medications, а не «противоэпилептические».

    Каноническое имя и синонимы вместо свободной строки: «Летирам»,
    «Леветирацетам» и «Кеппра» — одно и то же вещество, и свободный ввод сделал
    бы записи несравнимыми. Поиск идёт и по синонимам.

    В таблице живут не только препараты: анкета семьи спрашивает «какие
    принимает», и вариантами ответа там же стоят «Другое (указать)», «Не
    принимает противоприступные препараты» и «Не знаю названия». Их отличает
    `is_drug`.
    """

    __tablename__ = "aed_drugs"

    name_ru: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    synonyms: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # См. `IntakeOption.retired`: на препарат ссылаются заполненные анкеты.
    retired: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    #: Строка называет ЛЕКАРСТВО, а не вариант ответа анкеты.
    #:
    #: Без этого признака подсказка в схеме лечения предлагала врачу «Не знаю
    #: названия» как препарат, и выбор подставлял эту строку в `drug_name`.
    #:
    #: Отличать служебные строки по названию нельзя: имя — не идентификатор.
    #: Ручки записи в этот справочник сегодня нет ни одной (`/dictionaries`
    #: только читает), то есть новые строки заводит миграция и страхует ревью,
    #: — но у таблицы нет и стабильного `code`, как у `intake_options`, поэтому
    #: любая будущая правка данных цепляется за отображаемое имя. Признак
    #: снимает эту зависимость там, где она клинически значима.
    #:
    #: Умолчание `true`: новая строка считается лекарством, пока не сказано
    #: иначе. Служебных строк три, лекарств три десятка.
    is_drug: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )


class PatientIntake(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin):
    """Ответы семьи из анкеты регистрации (ADR-0007).

    Отдельная таблица, а не колонки в `medical_profiles`: профиль пишет только
    врач, а это — ответы семьи. Разделение по таблицам выражает право записи
    связью, а не проверкой в каждой ручке (правило 5 CLAUDE.md).

    Одна строка на пациента: анкета заполняется один раз при заведении ребёнка
    и потом уточняется, а не накапливается версиями.
    """

    __tablename__ = "patient_intake"
    __table_args__ = (
        # Дата и её точность согласованы: у неточной даты день (и месяц) —
        # первые, у «не помню» и «не отвечено» даты нет.
        CheckConstraint(
            "CASE last_seizure_precision "
            "WHEN 'day' THEN last_seizure_on IS NOT NULL "
            "WHEN 'month' THEN last_seizure_on IS NOT NULL "
            "AND EXTRACT(DAY FROM last_seizure_on) = 1 "
            "WHEN 'year' THEN last_seizure_on IS NOT NULL "
            "AND EXTRACT(DAY FROM last_seizure_on) = 1 "
            "AND EXTRACT(MONTH FROM last_seizure_on) = 1 "
            "ELSE last_seizure_on IS NULL END",
            name="ck_patient_intake_last_seizure_precision",
        ),
    )

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Дата последнего приступа **на момент анкеты**. Дальше она вычисляется из
    # дневника: хранить её обновляемым полем нельзя — она немедленно разойдётся
    # с записями, а лечение сверяется с записями (ADR-0007).
    #
    # Семья не всегда помнит число (вопрос 48, ADR-0049): дата бывает точной,
    # до месяца или до года — тогда хранится первым днём месяца или года, — а
    # бывает «не помню», и тогда даты нет. Точность лежит рядом и печатается
    # вместе с датой: «март 2026» не должен стать «01.03.2026».
    last_seizure_on: Mapped[date | None] = mapped_column(Date)
    last_seizure_precision: Mapped[LastSeizurePrecision | None] = mapped_column(
        pg_enum(LastSeizurePrecision, "last_seizure_precision")
    )

    onset_age_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )
    seizure_frequency_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )
    #: Частота приступов ДО начала кетодиетотерапии — то, с чем сравнивают.
    #:
    #: Ответ клиники от 09.09.2026 (вопрос 19): «Исходная частота перед началом
    #: кетогенной диеты фиксируется отдельно и в дальнейшем не
    #: перезаписывается». Эффект терапии измеряют снижением ОТНОСИТЕЛЬНО
    #: исходного уровня (>50 % — ответ, >90 % — почти полный контроль), и если
    #: исходный уровень лежит одним полем и переписывается при каждой правке
    #: анкеты, сравнивать становится не с чем: через полгода в карте останется
    #: только сегодняшняя частота, и «стало лучше» подтвердить будет нечем.
    #:
    #: Пишется ОДИН РАЗ и только ПОКА ТЕРАПИЯ НЕ НАЧАЛАСЬ — то есть пока у
    #: пациента нет ни одного назначения. «Первый непустой ответ» не годится:
    #: семья, впервые ответившая про частоту через полгода на диете, получила бы
    #: сегодняшний уровень как исходный — навсегда и молча.
    #:
    #: Если частоту впервые назвали уже на терапии, поле остаётся пустым:
    #: «неизвестно» честнее выдуманного (`TODO(med)`: вопрос 49).
    #:
    #: Правило живёт в репозитории (`repositories.intake.upsert`), а не в ручке:
    #: там его невозможно обойти новым маршрутом. Наружу поле уходит только на
    #: чтение, схема записи его не принимает.
    baseline_seizure_frequency_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )
    seizure_duration_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )
    # Кратность приёмов пищи **до терапии**, со слов семьи. Не то же, что
    # `prescriptions.meals_per_day`: там предписание врача, и одно поле на два
    # смысла означало бы, что назначение переписывается ответом родителя.
    meals_per_day_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("intake_options.id", ondelete="RESTRICT")
    )

    developmental_delay: Mapped[bool | None] = mapped_column(Boolean)
    meals_regular: Mapped[bool | None] = mapped_column(Boolean)

    # Что ребёнок принимает — со слов семьи, ориентировочно. Точный список с
    # дозами ведёт врач в `medications`: на анкете родитель дозы не знает, а
    # доза и кратность приёма у `medications` обязательны и обязательными
    # остаются.
    current_aed_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
