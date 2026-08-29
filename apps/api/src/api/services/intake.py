"""Проверка ответов анкеты регистрации (ADR-0007).

Внешний ключ отвечает только на вопрос «существует ли такой вариант», но не на
вопрос «из той ли он шкалы». Без этой проверки «Ежедневно» записывается в
длительность приступа, а «Более 5 препаратов» — в возраст дебюта, и анкета,
ради которой всё затевалось (данные, пригодные для анализа), перестаёт что-либо
значить.

Живёт в сервисах, а не в роутере: то же самое проверяет врачебное поле в
медицинском профиле, и вторая копия проверки разошлась бы с первой.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from core.models.enums import IntakeScale
from core.repositories import intake as intake_repo

from ..errors import ApiError, ErrorCode


async def check_option_scale(
    session: AsyncSession,
    *,
    option_id: uuid.UUID | None,
    scale: IntakeScale,
    field: str,
) -> None:
    """Вариант принадлежит нужной шкале. `None` — поле не заполнено, это норма."""

    if option_id is None:
        return

    options = await intake_repo.list_options(session, scale=scale)
    if option_id not in {option.id for option in options}:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Выбран вариант не из того списка.",
            details={"field": field},
        )


async def check_known_drugs(session: AsyncSession, drug_ids: list[uuid.UUID]) -> None:
    if not drug_ids:
        return

    # Справочник заказчика — 16 позиций; предел выборки взят с запасом на
    # пополнение медицинской командой, а не как страница выдачи.
    drugs, _ = await intake_repo.list_drugs(session, limit=1000)
    known = {drug.id for drug in drugs}
    unknown = [str(drug_id) for drug_id in drug_ids if drug_id not in known]
    if unknown:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "В списке препаратов есть неизвестные значения.",
            details={"unknown": unknown},
        )
