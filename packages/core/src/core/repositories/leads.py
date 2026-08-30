"""Заявки с посадочной страницы (ADR-0012)."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Lead
from ..models.enums import LeadAudience


async def upsert(
    session: AsyncSession, *, email: str, audience: LeadAudience, locale: str
) -> tuple[Lead, bool]:
    """Создаёт заявку либо возвращает уже существующую.

    Возвращает `(заявка, создана_ли)`. Повторная отправка формы — не ошибка:
    человек мог не дождаться ответа и нажать кнопку ещё раз, и показывать ему
    «такая заявка уже есть» бессмысленно. Ручка в обоих случаях отвечает
    одинаково, поэтому по ответу нельзя проверить, оставлял ли данный адрес
    заявку раньше.
    """

    normalized = email.strip().lower()
    existing = await session.scalar(
        select(Lead).where(Lead.email == normalized, Lead.audience == audience)
    )
    if existing is not None:
        return existing, False

    lead = Lead(email=normalized, audience=audience, locale=locale)
    session.add(lead)
    await session.flush()
    return lead, True


async def list_leads(
    session: AsyncSession, *, limit: int = 50, offset: int = 0
) -> tuple[list[Lead], int]:
    """Свежие заявки сверху: список читают, чтобы связаться с людьми."""

    stmt = select(Lead).order_by(Lead.created_at.desc()).limit(limit).offset(offset)
    items = list(await session.scalars(stmt))
    total = await session.scalar(select(func.count()).select_from(Lead))
    return items, int(total or 0)
