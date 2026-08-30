"""Вложения пациента: документы, которые семья приносит из стационара.

ADR-0004 (подсистема) и ADR-0013 (решения, которых в нём не было).

Вложение пациента — клинические данные, поэтому каждая ручка проходит ту же
проверку доступа, что и остальные данные пациента. Администратор доступа не
имеет (правило 5 CLAUDE.md).
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, File, Form, Path, Request, Response, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from core.models import Attachment
from core.models.enums import AttachmentDocKind, AttachmentOwnerKind
from core.repositories import attachments as attachments_repo
from core.repositories import audit as audit_repo

from ..client_address import client_address
from ..deps.auth import PatientAccessDep, SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas_attachments import AttachmentRead
from ..services import attachments as files_service

router = APIRouter(prefix="/patients/{patient_id}/attachments", tags=["attachments"])


@router.get("", response_model=list[AttachmentRead], summary="Документы пациента")
async def list_attachments(
    patient_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    _: PatientAccessDep,
) -> list[AttachmentRead]:
    rows = await attachments_repo.list_for_owner(
        session, owner_kind=AttachmentOwnerKind.PATIENT, owner_id=patient_id
    )
    return [AttachmentRead.model_validate(row) for row in rows]


@router.post(
    "",
    response_model=AttachmentRead,
    status_code=201,
    summary="Загрузить документ пациента",
)
async def upload_attachment(
    patient_id: Annotated[uuid.UUID, Path()],
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
    file: Annotated[UploadFile, File()],
    doc_kind: Annotated[AttachmentDocKind | None, Form()] = None,
    doc_date: Annotated[str | None, Form()] = None,
    description: Annotated[str | None, Form()] = None,
) -> AttachmentRead:
    """Принимает файл и описание одним multipart-запросом.

    Тип определяется по сигнатуре файла, а не по `Content-Type` и не по
    расширению: и то и другое подделывается тривиально (OWASP File Upload Cheat
    Sheet). Имя на диске генерирует приложение — исходное хранится отдельно и в
    пути не участвует.

    Загрузка в аудит не пишется: журнал фиксирует выгрузки данных, а внесение
    своего документа выгрузкой не является. След того, кто загрузил, остаётся в
    самой строке (`uploaded_by`).
    """

    content = await file.read()
    mime = files_service.validate(content)

    parsed_date = None
    if doc_date:
        try:
            parsed_date = date.fromisoformat(doc_date)
        except ValueError as exc:
            raise ApiError(ErrorCode.VALIDATION_ERROR, "Дата документа указана неверно.") from exc

    stored_name = files_service.generate_stored_name(mime)
    await run_in_threadpool(files_service.write_file, stored_name, content)

    attachment = await attachments_repo.create(
        session,
        owner_kind=AttachmentOwnerKind.PATIENT,
        owner_id=patient_id,
        # Имя от клиента обрезается по длине колонки: длинное имя иначе уронило
        # бы запись на уровне базы уже после того, как файл лёг на диск.
        filename=(file.filename or "файл")[:255],
        stored_name=stored_name,
        mime=mime,
        size_bytes=len(content),
        sha256=files_service.sha256_of(content),
        uploaded_by=user.id,
        doc_kind=doc_kind,
        doc_date=parsed_date,
        description=(description or None),
    )
    return AttachmentRead.model_validate(attachment)


@router.get("/{attachment_id}/file", summary="Скачать документ пациента")
async def download_attachment(
    patient_id: Annotated[uuid.UUID, Path()],
    attachment_id: Annotated[uuid.UUID, Path()],
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> Response:
    """Отдаёт файл.

    Изображения — `inline`, PDF — вложением: из четырёх разрешённых типов
    опасен один, он открывается встроенным просмотрщиком с origin кабинета
    (ADR-0013, решение 4).

    Скачивание пишется в аудит: это выгрузка данных (правило 7). Имя файла в
    журнал не идёт — оно пришло от семьи и может содержать ФИО ребёнка, а
    журнал читает администратор, которому клинические данные недоступны.
    """

    attachment = await _owned_attachment(session, patient_id, attachment_id)

    file_path = await run_in_threadpool(files_service.resolve_file, attachment.stored_name)
    if file_path is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Файл недоступен.")

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="export",
        entity="attachments",
        entity_id=attachment.id,
        ip=client_address(request),
    )

    return FileResponse(
        file_path,
        media_type=attachment.mime,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": files_service.content_disposition(
                attachment.mime, attachment.filename
            ),
        },
    )


@router.delete("/{attachment_id}", status_code=204, summary="Удалить документ пациента")
async def delete_attachment(
    patient_id: Annotated[uuid.UUID, Path()],
    attachment_id: Annotated[uuid.UUID, Path()],
    request: Request,
    session: SessionDep,
    user: PatientAccessDep,
) -> Response:
    """Удаляет вложение, если его загрузил тот же человек.

    Решение заказчика (ADR-0013): родитель убирает свою ошибку, врач — свою,
    чужой документ из карты не убирает никто. Удаление мягкое (правило 4).
    """

    attachment = await _owned_attachment(session, patient_id, attachment_id)

    if attachment.uploaded_by != user.id:
        raise ApiError(
            ErrorCode.FORBIDDEN,
            "Удалить документ может только тот, кто его загрузил.",
        )

    await attachments_repo.soft_delete(session, attachment=attachment)

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="delete",
        entity="attachments",
        entity_id=attachment.id,
        ip=client_address(request),
    )
    return Response(status_code=204)


async def _owned_attachment(
    session: SessionDep, patient_id: uuid.UUID, attachment_id: uuid.UUID
) -> Attachment:
    """Вложение этого пациента — или 404.

    Принадлежность проверяется, а не подразумевается: без неё доступ к своему
    пациенту открывал бы любое вложение по идентификатору, включая чужое.
    Расхождение владельца отдаётся как 404, а не 403: 403 подтвердил бы, что
    вложение с таким идентификатором существует.
    """

    attachment = await attachments_repo.get(session, attachment_id)
    if (
        attachment is None
        or attachment.owner_kind is not AttachmentOwnerKind.PATIENT
        or attachment.owner_id != patient_id
    ):
        raise ApiError(ErrorCode.NOT_FOUND, "Документ не найден.")
    return attachment
