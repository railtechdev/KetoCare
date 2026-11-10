"""Menu templates of a food standard (ADR-0060). Read-only for the application."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MenuTemplate, MenuTemplateItem


async def list_for_standard(session: AsyncSession, *, standard_id: uuid.UUID) -> list[MenuTemplate]:
    stmt = (
        select(MenuTemplate)
        .where(MenuTemplate.standard_id == standard_id)
        .order_by(MenuTemplate.title, MenuTemplate.id)
    )
    return list(await session.scalars(stmt))


async def get(session: AsyncSession, template_id: uuid.UUID) -> MenuTemplate | None:
    return await session.get(MenuTemplate, template_id)


async def list_items(
    session: AsyncSession, *, template_id: uuid.UUID
) -> Sequence[MenuTemplateItem]:
    stmt = (
        select(MenuTemplateItem)
        .where(MenuTemplateItem.template_id == template_id)
        .order_by(
            MenuTemplateItem.cycle_day, MenuTemplateItem.meal_index, MenuTemplateItem.position
        )
    )
    return list(await session.scalars(stmt))
