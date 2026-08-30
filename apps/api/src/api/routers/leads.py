"""`/leads` — заявки с посадочной страницы (ADR-0012).

Единственная публичная ручка записи во всём API: её вызывает форма на сайте,
у посетителя которого учётной записи ещё нет. Отсюда особенности.

**Ограничение частоты.** Без него открытая форма записи — это приглашение
залить таблицу мусором. Лимит мягче, чем у `/auth/*`: там ключ по адресу
защищает от подбора секрета, здесь — от массовой отправки, а за одним NAT
сидит много людей.

**Приманка.** Скрытое поле `company`, которое человек не заполняет; ботам,
заполняющим все поля подряд, отвечаем обычным успехом. Сообщать спамеру, что
он распознан, — значит помогать ему подобрать обход.

**Ответ одинаковый** и для новой заявки, и для повторной: иначе по коду ответа
можно проверять, оставлял ли конкретный адрес заявку, — то есть проверять
чужую почту на присутствие в нашей базе.

Аудита здесь нет: `audit_log` ведётся для действий с клиническими данными,
учётными записями и выгрузками (правило 7 CLAUDE.md), а заявка — не из них, и
пользователя, от чьего имени писать запись, тоже нет.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status

from core.models.enums import UserRole
from core.repositories import leads as leads_repo

from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..deps.query import PaginationDep
from ..ratelimit import LEADS_RATE_LIMIT, limiter
from ..schemas import Page
from ..schemas_leads import LeadCreate, LeadRead

router = APIRouter(prefix="/leads", tags=["leads"])


@router.post(
    "",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Оставить заявку с посадочной страницы",
    response_class=Response,
)
@limiter.limit(LEADS_RATE_LIMIT)
async def create_lead(
    request: Request,
    payload: LeadCreate,
    session: SessionDep,
) -> Response:
    """Принимает заявку. Тело ответа пустое: сайту нечего показывать, кроме
    заранее написанного «спасибо», а любые подробности здесь — это утечка
    сведений о том, что уже лежит в базе."""

    # Приманка заполнена — это бот. Отвечаем как при успехе, но ничего не пишем.
    if payload.company:
        return Response(status_code=status.HTTP_202_ACCEPTED)

    await leads_repo.upsert(
        session,
        email=payload.email,
        audience=payload.audience,
        locale=payload.locale,
    )
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.get(
    "",
    response_model=Page[LeadRead],
    summary="Список заявок",
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
)
async def list_leads(
    session: SessionDep,
    _: CurrentUserDep,
    page: PaginationDep,
) -> Page[LeadRead]:
    """Читает администратор: заявки — это работа с контактами, а не с
    клиническими данными, к которым админу доступ закрыт."""

    items, total = await leads_repo.list_leads(session, limit=page.limit, offset=page.offset)
    return Page(items=[LeadRead.model_validate(lead) for lead in items], total=total)
