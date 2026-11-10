"""Стандарты питания (ADR-0056)."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import FoodStandard


async def get(session: AsyncSession, standard_id: uuid.UUID) -> FoodStandard | None:
    return await session.get(FoodStandard, standard_id)
