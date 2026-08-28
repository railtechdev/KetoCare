"""`/users` — справочник персонала (ADR-0003).

Нужен для передачи пациента коллеге: чтобы указать врача, его надо выбрать.
Клинических данных здесь нет — идентификатор, имя и роль активных специалистов.
Видят справочник только doctor и dietitian: родителю он не нужен, а
администратор пациентами не распоряжается (раздел 5.1 ТЗ).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from core.models.enums import UserRole
from core.repositories import users as users_repo

from ..deps.auth import SessionDep, require_roles
from ..schemas import ColleagueRead

router = APIRouter(prefix="/users", tags=["users"])

CARE_ROLES = (UserRole.DOCTOR, UserRole.DIETITIAN)


@router.get(
    "/colleagues",
    response_model=list[ColleagueRead],
    summary="Врачи и диетологи клиники",
    dependencies=[Depends(require_roles(*CARE_ROLES))],
)
async def list_colleagues(session: SessionDep) -> list[ColleagueRead]:
    users = await users_repo.list_active_by_roles(session, roles=CARE_ROLES)
    return [ColleagueRead.model_validate(u) for u in users]
