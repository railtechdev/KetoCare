"""Дневники: общая часть шести видов записей (раздел 5.3 ТЗ, группа `/logs`).

Виды записей различаются только набором специфичных полей, поэтому список,
создание, изменение и мягкое удаление реализованы один раз и параметризованы
моделью и схемой ответа. Кроме того, здесь живут проверки, которые нельзя
сделать в pydantic: они требуют обращения к БД (ссылки на записи пациента).
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import MealLog
from core.models.enums import DiarySource
from core.repositories import diary as diary_repo
from core.repositories.diary import DiaryLog

from ..deps.auth import CurrentUser
from ..deps.query import Pagination, Period
from ..errors import ApiError, ErrorCode
from ..schemas import Page
from ..schemas_logs import LogCreate, LogUpdate, MealLogCreate

# Канал проставляет сервер, а не клиент (раздел 5.3 ТЗ). У этой группы ручек он
# один — веб; бот и Mini App появляются на этапах 3-4 и придут со своим каналом.
# Если бы `source` приходил из тела запроса, запись из веба могла бы объявить себя
# подтверждённым разбором ИИ, а в отчёте врача это разные по достоверности данные.
CHANNEL_SOURCE = DiarySource.WEB


async def list_logs[M: DiaryLog, R: BaseModel](
    session: AsyncSession,
    model: type[M],
    read: type[R],
    *,
    patient_id: uuid.UUID,
    period: Period,
    page: Pagination,
) -> Page[R]:
    items, total = await diary_repo.list_for_patient(
        session,
        model,
        patient_id=patient_id,
        period_from=period.period_from,
        period_to=period.period_to,
        limit=page.limit,
        offset=page.offset,
    )
    return Page(items=[read.model_validate(item) for item in items], total=total)


async def create_log[M: DiaryLog, R: BaseModel](
    session: AsyncSession,
    model: type[M],
    read: type[R],
    *,
    patient_id: uuid.UUID,
    payload: LogCreate,
    author: CurrentUser,
) -> R:
    fields = payload.model_dump(exclude={"occurred_at"})
    if isinstance(payload, MealLogCreate):
        _check_meal_content(payload.menu_item_id, payload.free_text)
    await _check_references(session, patient_id=patient_id, fields=fields)

    log = await diary_repo.create(
        session,
        model,
        patient_id=patient_id,
        occurred_at=payload.occurred_at,
        source=CHANNEL_SOURCE,
        created_by=author.id,
        fields=fields,
    )
    return read.model_validate(log)


async def update_log[M: DiaryLog, R: BaseModel](
    session: AsyncSession,
    model: type[M],
    read: type[R],
    *,
    patient_id: uuid.UUID,
    log_id: uuid.UUID,
    payload: LogUpdate,
) -> R:
    log = await _owned_log(session, model, log_id=log_id, patient_id=patient_id)

    # exclude_unset: не переданное поле остаётся как есть, а явный null очищает
    # обнуляемое поле. Для NOT NULL-полей null отклоняют схемы (см. schemas_logs).
    fields = payload.model_dump(exclude_unset=True)
    if isinstance(log, MealLog):
        _check_meal_content(
            fields.get("menu_item_id", log.menu_item_id),
            fields.get("free_text", log.free_text),
        )
    await _check_references(session, patient_id=patient_id, fields=fields)

    updated = await diary_repo.update(session, log=log, fields=fields)
    return read.model_validate(updated)


async def delete_log[M: DiaryLog](
    session: AsyncSession, model: type[M], *, patient_id: uuid.UUID, log_id: uuid.UUID
) -> None:
    """Мягкое удаление: дневниковые записи физически не удаляются (правило 4 CLAUDE.md)."""

    log = await _owned_log(session, model, log_id=log_id, patient_id=patient_id)
    await diary_repo.soft_delete(session, log=log)


async def _owned_log[M: DiaryLog](
    session: AsyncSession, model: type[M], *, log_id: uuid.UUID, patient_id: uuid.UUID
) -> M:
    """Запись, принадлежащая именно этому пациенту.

    Проверка отдельно от `require_patient_access`: доступ к пациенту не даёт прав
    на запись, привязанную к другому. Несовпадение отдаём как 404, а не 403 —
    иначе по коду ответа можно узнать, что такая запись существует у кого-то ещё.
    """

    log = await diary_repo.get(session, model, log_id)
    if log is None or log.patient_id != patient_id:
        raise ApiError(ErrorCode.NOT_FOUND, "Запись дневника не найдена.")
    return log


def _check_meal_content(menu_item_id: uuid.UUID | None, free_text: str | None) -> None:
    """Запись о еде без позиции меню и без текста не несёт информации: в дневнике
    это пустая строка, а в отчёте врача — приём пищи без состава."""

    if menu_item_id is None and not free_text:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Укажите позицию меню или опишите еду текстом.",
        )


async def _check_references(
    session: AsyncSession, *, patient_id: uuid.UUID, fields: dict[str, object]
) -> None:
    """Ссылки на другие таблицы обязаны вести на записи того же пациента.

    Без этой проверки в дневник ребёнка попал бы препарат или позиция меню другого
    пациента — и на графике приёма лекарств появились бы чужие данные.

    Сообщение одно и то же и для несуществующей записи, и для чужой: иначе по
    ответу можно было бы установить, что такой препарат существует у кого-то ещё.
    """

    seizure_type_id = fields.get("seizure_type_id")
    if isinstance(seizure_type_id, uuid.UUID) and not await diary_repo.seizure_type_exists(
        session, seizure_type_id
    ):
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Тип приступа не найден в справочнике.")

    medication_id = fields.get("medication_id")
    if isinstance(medication_id, uuid.UUID) and not await diary_repo.medication_belongs_to_patient(
        session, medication_id=medication_id, patient_id=patient_id
    ):
        raise ApiError(
            ErrorCode.VALIDATION_ERROR, "Препарат не найден среди назначенных этому пациенту."
        )

    menu_item_id = fields.get("menu_item_id")
    if isinstance(menu_item_id, uuid.UUID) and not await diary_repo.menu_item_belongs_to_patient(
        session, menu_item_id=menu_item_id, patient_id=patient_id
    ):
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Позиция меню не найдена у этого пациента.")
