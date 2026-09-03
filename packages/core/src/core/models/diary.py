"""Питание и дневники (раздел 4.2 ТЗ).

Дизайн-решение (см. docs/adr/0001-db-schema-interpretation.md): общие поля
"у всех" (patient_id, occurred_at, source, created_by, deleted_at) применены
буквально к шести таблицам логов событий (seizure_logs..side_effect_logs).
menus/menu_items получают patient_id + deleted_at + created_by, но не
occurred_at/source — у них есть собственный временной якорь (date/menu_id),
и раздел 4.2 "Индексы" явно связывает occurred_at именно с "дневниками"
(логами событий), а не с планом меню.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from .base import Base, CreatedAtMixin, SoftDeleteMixin, UpdatedAtMixin, UUIDPkMixin
from .enums import DiarySource, KetoneMethod, MealSlot, pg_enum


class SeizureType(Base, UUIDPkMixin):
    __tablename__ = "seizure_types"

    name_ru: Mapped[str] = mapped_column(String(255), nullable=False)
    # Короткий код типа (A, C, F, FG, M, T, TC, O) из дневника KETO-STEP,
    # присланного заказчиком: в клетке месячной сетки «Тонико-клонический» не
    # помещается, «TC» — да (ADR-0007). Необязателен: своего кода у типов вне
    # того дневника пока нет — вопрос 4 в docs/medical/OPEN_QUESTIONS.md.
    code: Mapped[str | None] = mapped_column(String(4))
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class KetoneMethodDict(Base, UUIDPkMixin):
    """Справочник методов измерения кетонов (не путать с enum `KetoneMethod` в `ketone_logs.method`,
    который остаётся простым enum-полем по разделу 4.2 ТЗ)."""

    __tablename__ = "ketone_methods"

    name_ru: Mapped[str] = mapped_column(String(255), nullable=False)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class DiaryLogMixin(UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin, SoftDeleteMixin):
    """Общие поля дневниковых логов: patient_id, occurred_at, source, created_by, deleted_at."""

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    occurred_at: Mapped[datetime] = mapped_column(nullable=False)
    source: Mapped[DiarySource] = mapped_column(
        pg_enum(DiarySource, "diary_source"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )

    @declared_attr.directive
    def __table_args__(cls) -> tuple[Index, ...]:  # noqa: N805
        tablename: str = cls.__tablename__  # type: ignore[attr-defined]
        return (Index(f"ix_{tablename}_patient_occurred", "patient_id", "occurred_at"),)


class SeizureLog(Base, DiaryLogMixin):
    __tablename__ = "seizure_logs"

    seizure_type_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("seizure_types.id"), nullable=False
    )
    #: Измеренная длительность. Только измеренная.
    #:
    #: Интервальный ответ («от 10 до 30 минут») сюда НЕ пересчитывается — ни
    #: нижней границей, ни серединой. Иначе догадка со слов становится
    #: неотличимой от засечённого секундомером, а по этому числу врач судит о
    #: течении болезни: 600 секунд из «10 минут и больше» и 600 секунд с
    #: секундомера — разные по достоверности данные (ADR-0020).
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    #: Интервал длительности со слов — вариант шкалы `seizure_duration`
    #: справочника анкеты (`intake_options`).
    #:
    #: Тот же справочник, что у анкеты регистрации, а не свой: семья отвечает на
    #: один и тот же вопрос в кабинете и в боте, и две шкалы про одно и то же
    #: означали бы, что ряды за разные месяцы нельзя сравнить между собой
    #: (вопрос 23 медицинской команде).
    duration_option_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("intake_options.id", ondelete="RESTRICT"),
        # Индекс на внешний ключ — общий инвариант схемы (раздел 4 ТЗ): без него
        # проверка RESTRICT при правке справочника читает дневник целиком.
        index=True,
    )
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    description: Mapped[str | None]
    triggers: Mapped[str | None]


class KetoneLog(Base, DiaryLogMixin):
    __tablename__ = "ketone_logs"

    value: Mapped[float] = mapped_column(Numeric(4, 1), nullable=False)
    method: Mapped[KetoneMethod] = mapped_column(
        pg_enum(KetoneMethod, "ketone_method"), nullable=False
    )


class WeightLog(Base, DiaryLogMixin):
    __tablename__ = "weight_logs"

    weight_kg: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    height_cm: Mapped[float | None] = mapped_column(Numeric(5, 1))


class MedicationLog(Base, DiaryLogMixin):
    __tablename__ = "medication_logs"

    medication_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("medications.id"), nullable=False
    )
    taken: Mapped[bool] = mapped_column(Boolean, nullable=False)


class MealLog(Base, DiaryLogMixin):
    __tablename__ = "meal_logs"

    menu_item_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("menu_items.id")
    )
    free_text: Mapped[str | None]
    parsed: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # результат AI-разбора


class SideEffectLog(Base, DiaryLogMixin):
    __tablename__ = "side_effect_logs"

    symptom: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None]


class Menu(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin, SoftDeleteMixin):
    __tablename__ = "menus"
    __table_args__ = (UniqueConstraint("patient_id", "date", name="uq_menu_patient_date"),)

    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    date: Mapped[date] = mapped_column(nullable=False)
    totals: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    engine_version: Mapped[str | None] = mapped_column(String(32))
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )


class MenuItem(Base, UUIDPkMixin, CreatedAtMixin, UpdatedAtMixin, SoftDeleteMixin):
    __tablename__ = "menu_items"

    menu_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("menus.id"), nullable=False
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    meal_slot: Mapped[MealSlot] = mapped_column(pg_enum(MealSlot, "meal_slot"), nullable=False)
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("recipes.id")
    )
    custom_dish_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("custom_dishes.id")
    )
    portion_factor: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False, default=1)
    eaten: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Состав и показатели блюда на момент сохранения дня.
    #:
    #: Позиция ссылается на рецепт или своё блюдо, а те живут своей жизнью:
    #: диетолог правит рецепт, администратор — числа продукта. Без снимка
    #: правка задним числом меняла прошлые дни при первом же их сохранении, и
    #: ответить, чем ребёнок питался первого мая, было нельзя — при том что
    #: запрет удалять использованный рецепт обоснован как раз сохранностью
    #: истории.
    #:
    #: Хранится всё, что нужно для повторного расчёта БЕЗ обращения к текущим
    #: строкам: название, число порций, ингредиенты вместе с их значениями на
    #: 100 г, итоги блюда и версия ядра.
    #:
    #: `None` — позиция, сохранённая до появления снимков: тогда состав
    #: читается по ссылке, как и раньше.
    snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id")
    )
