"""Общие параметры запроса: пагинация и фильтр периода (раздел 5.1 ТЗ).

Вынесены из схем дневников: те же `?limit&offset` и `?from&to` нужны спискам
продуктов, рецептов, назначений и аудита. Пока каждая ручка объявляла их
литералами, границы расходились — где-то `le=200`, где-то `le=100`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

from fastapi import Depends, Query
from pydantic import AwareDatetime

from ..errors import ApiError, ErrorCode

#: Верхняя граница страницы. Больше — риск отдать клиенту выборку, которую он
#: всё равно не покажет, и нагрузить БД.
MAX_PAGE_SIZE = 200


@dataclass(frozen=True, slots=True)
class Pagination:
    limit: int = 50
    offset: int = 0


@dataclass(frozen=True, slots=True)
class Period:
    """Границы периода по `occurred_at`, обе включительно."""

    period_from: datetime | None = None
    period_to: datetime | None = None


def pagination(
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Pagination:
    return Pagination(limit=limit, offset=offset)


def period_filter(
    period_from: Annotated[
        AwareDatetime | None, Query(alias="from", description="Начало периода включительно")
    ] = None,
    period_to: Annotated[
        AwareDatetime | None, Query(alias="to", description="Конец периода включительно")
    ] = None,
) -> Period:
    if period_from is not None and period_to is not None and period_from > period_to:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Начало периода позже его конца.")
    return Period(period_from=period_from, period_to=period_to)


PaginationDep = Annotated[Pagination, Depends(pagination)]
PeriodDep = Annotated[Period, Depends(period_filter)]
