"""`/leads` — заявки с посадочной страницы (ADR-0012).

Единственная публичная ручка записи во всём API: её вызывает форма на сайте,
у посетителя которого учётной записи ещё нет. Отсюда особенности.

**Ограничение частоты.** Без него открытая форма записи — это приглашение
залить таблицу мусором. Лимит мягче, чем у `/auth/*`: там ключ по адресу
защищает от подбора секрета, здесь — от массовой отправки, а за одним NAT
сидит много людей.

**Приманка.** Скрытое поле `website`, которое человек не заполняет; ботам,
заполняющим все поля подряд, отвечаем обычным успехом. Сообщать спамеру, что
он распознан, — значит помогать ему подобрать обход.

**Ответ одинаковый** и для новой заявки, и для повторной: иначе по коду ответа
можно проверять, оставлял ли конкретный адрес заявку, — то есть проверять
чужую почту на присутствие в нашей базе.

**Аудит.** На запись его нет: правило 7 перечисляет клинические данные,
учётные записи и выгрузки, заявка не из них, да и пользователя, от чьего имени
писать запись, не существует. А вот чтение и удаление списка администратором
пишутся: `audience=family` рядом с адресом почты — это, по сути, сведение о
здоровье ребёнка в семье, и просмотр всей такой базы ближе к выгрузке данных,
чем к обычному чтению справочника.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, Response, status

from core.models.enums import UserRole
from core.repositories import audit as audit_repo
from core.repositories import leads as leads_repo

from ..client_address import client_address
from ..deps.auth import CurrentUserDep, SessionDep, require_roles
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
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
    заранее написанного «спасибо», а любые подробности здесь — это сведения о
    том, что уже лежит в базе."""

    # Приманка заполнена — это бот. Отвечаем как при успехе, но ничего не пишем.
    if payload.website:
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
    request: Request,
    session: SessionDep,
    user: CurrentUserDep,
    page: PaginationDep,
) -> Page[LeadRead]:
    """Читает администратор: заявки — работа с контактами, а не с клиническими
    данными, к которым админу доступ закрыт."""

    items, total = await leads_repo.list_leads(session, limit=page.limit, offset=page.offset)
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="leads.list",
        entity="leads",
        after={"returned": len(items), "total": total},
        ip=client_address(request),
    )
    return Page(items=[LeadRead.model_validate(lead) for lead in items], total=total)


@router.delete(
    "/{lead_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Удалить заявку",
    dependencies=[Depends(require_roles(UserRole.ADMIN))],
    response_class=Response,
)
async def delete_lead(
    request: Request,
    lead_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUserDep,
) -> Response:
    """Человек вправе попросить убрать свой контакт, и способ выполнить это
    должен существовать. Удаление физическое: правило о мягком удалении
    защищает историю болезни, а не список рассылки."""

    deleted = await leads_repo.delete_lead(session, lead_id)
    if not deleted:
        raise ApiError(ErrorCode.NOT_FOUND, "Заявка не найдена.")

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="leads.delete",
        entity="leads",
        entity_id=lead_id,
        ip=client_address(request),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
