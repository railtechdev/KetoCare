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

from core.models import AiJob, MealLog
from core.models.enums import AiJobKind, AiJobStatus, DiarySource
from core.repositories import ai_jobs as ai_jobs_repo
from core.repositories import diary as diary_repo
from core.repositories.diary import DiaryLog

from ..deps.auth import CurrentUser
from ..deps.query import Pagination, Period
from ..errors import ApiError, ErrorCode
from ..schemas import Page
from ..schemas_logs import LogCreate, LogUpdate, MealLogCreate
from ..security import Channel

# Канал проставляет сервер, а не клиент (раздел 5.3 ТЗ). Если бы `source` приходил
# из тела запроса, запись из веба могла бы объявить себя подтверждённым разбором
# ИИ, а в отчёте врача это разные по достоверности данные.
_SOURCE_BY_CHANNEL: dict[Channel, DiarySource] = {
    "web": DiarySource.WEB,
    "bot": DiarySource.BOT,
    "miniapp": DiarySource.MINIAPP,
}


def channel_source(author: CurrentUser) -> DiarySource:
    """Откуда пришла запись — из канала токена, а не из запроса.

    Раздел 4.2 ТЗ требует различать `web` и `bot`: врач в отчёте должен видеть,
    записан ли приступ в кабинете за столом или на бегу в чате. Пока бота не
    было, значение было константой; теперь оно выводится из личности автора.
    """

    return _SOURCE_BY_CHANNEL[author.channel]


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
    # По умолчанию — канал, из которого пришла запись; подтверждённый разбор
    # ниже подменяет его на `ai_parsed`.
    source = channel_source(author)
    job = None
    if isinstance(payload, MealLogCreate):
        _check_meal_content(payload.menu_item_id, payload.free_text)
        # Подтверждение разбора: структура берётся из журнала, а не из тела.
        fields.pop("ai_job_id", None)
        if payload.ai_job_id is not None:
            job = await _job_for_confirmation(
                session, ai_job_id=payload.ai_job_id, patient_id=patient_id, author=author
            )
            fields["parsed"] = (job.output or {})["parsed"]
            # Происхождение — `ai_parsed`, а не канал, из которого пришли
            # (раздел 5.4 ТЗ). Разница клиническая: «55 г» из разбора — оценка
            # модели по фразе «одно яйцо», а такие же 55 г, набранные руками, —
            # взвешенная порция. В карточке дневника у `ai_parsed` своя пометка
            # «Распознано ИИ» (`DiaryEntryCard`), и без этой строки она не
            # появлялась бы никогда: врач не отличил бы оценку от измерения.
            source = DiarySource.AI_PARSED
    await _check_references(session, patient_id=patient_id, fields=fields)

    log = await diary_repo.create(
        session,
        model,
        patient_id=patient_id,
        occurred_at=payload.occurred_at,
        source=source,
        created_by=author.id,
        fields=fields,
    )

    if job is not None:
        # Отметка ставится после создания записи, в той же транзакции: разбор
        # подтверждён и израсходован.
        await ai_jobs_repo.mark_confirmed(session, job=job, log_id=log.id)

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


async def _job_for_confirmation(
    session: AsyncSession,
    *,
    ai_job_id: uuid.UUID,
    patient_id: uuid.UUID,
    author: CurrentUser,
) -> AiJob:
    """Разбор из журнала — с проверками, без которых он не разбор, а чужие данные.

    Пять условий, и каждое закрывает свой способ подсунуть в дневник то, чего не
    было: задача существует; её заказывал ЭТОТ человек; она про ЭТОГО ребёнка;
    она действительно разбор еды и он удался; и она ещё не израсходована.

    Последнее — про двойное нажатие и повтор запроса: разбор описывает один
    приём пищи, и второй раз он подтверждаться не должен, иначе в дне ребёнка
    появятся жиры, которых он не ел. Сообщение на все случаи одно: по разнице
    ответов иначе устанавливалось бы, что чужая задача существует.
    """

    job = await ai_jobs_repo.get(session, ai_job_id)
    output = (job.output or {}) if job is not None else {}

    if (
        job is None
        or job.requested_by != author.id
        or job.patient_id != patient_id
        or job.kind != AiJobKind.PARSE_MEAL
        or job.status != AiJobStatus.DONE
        or not isinstance(output.get("parsed"), dict)
        or output.get("confirmed_log_id") is not None
    ):
        raise ApiError(ErrorCode.NOT_FOUND, "Разбор не найден. Повторите разбор текста.")

    return job


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

    duration_option_id = fields.get("duration_option_id")
    if isinstance(duration_option_id, uuid.UUID) and not await diary_repo.duration_option_is_usable(
        session, duration_option_id
    ):
        raise ApiError(
            ErrorCode.VALIDATION_ERROR, "Такого варианта длительности нет в справочнике."
        )

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
