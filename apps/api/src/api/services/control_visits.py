"""Контрольные визиты: представление для экранов (вопросы 17, 18 и 34; ADR-0050).

Перечень анализов, назначение точки и «просрочен ли» не хранятся: первое и
второе выводятся из месяца графика по ответам клиники (`core.control_schedule`),
третье — из сегодняшнего дня. Храни мы их в строке, ответ клиники на вопрос 34
пришлось бы переносить в каждую уже заведённую строку.
"""

from __future__ import annotations

from datetime import date

from core.control_schedule import labs_for, purpose_for
from core.models import ControlVisit

from ..schemas_clinical import ControlVisitRead


def visit_read(visit: ControlVisit, *, today: date) -> ControlVisitRead:
    return ControlVisitRead.model_validate(visit).model_copy(
        update={
            "purpose": purpose_for(visit.month_offset),
            "labs": list(labs_for(visit.month_offset)),
            "overdue": visit.completed_on is None and visit.planned_on < today,
        }
    )
