"""Заявки с посадочной страницы (ADR-0012)."""

from __future__ import annotations

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Lead
from ..models.enums import LeadAudience


async def upsert(session: AsyncSession, *, email: str, audience: LeadAudience, locale: str) -> None:
    """Записывает заявку; повторная отправка того же адреса ничего не меняет.

    `ON CONFLICT DO NOTHING`, а не «сначала SELECT, потом INSERT»: между
    проверкой и вставкой помещается второй такой же запрос, и тогда уникальное
    ограничение роняет вставку в 500. Форму нажимают дважды именно тогда, когда
    ответ пришёл не сразу, — то есть ровно в момент, когда гонка вероятнее
    всего.

    Ничего не возвращает намеренно: ручка отвечает одинаково и на новую заявку,
    и на повторную, иначе по ответу можно проверять чужой адрес на присутствие
    в базе.
    """

    await session.execute(
        pg_insert(Lead)
        .values(email=email.strip().lower(), audience=audience, locale=locale)
        .on_conflict_do_nothing(constraint="uq_lead_email_audience")
    )


async def delete_lead(session: AsyncSession, lead_id: uuid.UUID) -> bool:
    """Физическое удаление — здесь оно уместно, в отличие от клинических
    записей (правило 4 CLAUDE.md). Это контакт человека, который попросил себя
    убрать; «мягко удалённый» контакт такую просьбу не выполняет.

    Возвращает, была ли строка."""

    # Возвращаемые строки, а не rowcount: у него нет типа в аннотациях
    # SQLAlchemy, и mypy в strict-режиме отвергает сравнение.
    result = await session.execute(delete(Lead).where(Lead.id == lead_id).returning(Lead.id))
    return result.scalar_one_or_none() is not None


async def list_leads(
    session: AsyncSession, *, limit: int = 50, offset: int = 0
) -> tuple[list[Lead], int]:
    """Свежие заявки сверху: список читают, чтобы связаться с людьми."""

    stmt = select(Lead).order_by(Lead.created_at.desc()).limit(limit).offset(offset)
    items = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(Lead))
    return items, int(total or 0)
