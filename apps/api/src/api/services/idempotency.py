"""Повторная отправка записи без второй записи (ADR-0035).

Опирается на черновик IETF «The Idempotency-Key HTTP Header Field»
(draft-ietf-httpapi-idempotency-key-header) и практику Stripe: клиент
присылает уникальный ключ с запросом записи, сервер запоминает ответ.

- тот же ключ и тот же запрос — прежний ответ, новой записи нет;
- тот же ключ и другой запрос — 422: клиент перепутал ключи;
- одновременный повтор ждёт первый запрос (уникальное ограничение в той же
  транзакции) и получает его ответ.

Без заголовка ручка работает как раньше: бот и старые клиенты ключа не шлют.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from core.repositories import idempotency as idempotency_repo

from ..errors import ApiError, ErrorCode


@dataclass(frozen=True)
class Replay:
    """Ответ, уже отданный запросу с этим ключом."""

    status: int
    body: dict[str, Any]


def request_fingerprint(method: str, path: str, body: bytes) -> str:
    digest = hashlib.sha256()
    digest.update(method.upper().encode())
    digest.update(b" ")
    digest.update(path.encode())
    digest.update(b"\n")
    digest.update(body)
    return digest.hexdigest()


async def begin(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    key: str,
    fingerprint: str,
    patient_id: uuid.UUID | None,
) -> uuid.UUID | Replay:
    """Бронь ключа под запрос или прежний ответ, если запрос уже выполнен."""

    reserved = await idempotency_repo.reserve(
        session,
        user_id=user_id,
        key=key,
        request_hash=fingerprint,
        patient_id=patient_id,
        now=datetime.now(UTC),
    )
    if reserved is not None:
        return reserved

    existing = await idempotency_repo.get(session, user_id=user_id, key=key)
    if existing is None or existing.response_body is None or existing.response_status is None:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Такой же запрос ещё выполняется. Повторите чуть позже.",
            details={"header": "Idempotency-Key"},
        )
    if existing.request_hash != fingerprint:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Ключ повторной отправки уже использован для другого запроса.",
            details={"header": "Idempotency-Key"},
        )
    return Replay(status=existing.response_status, body=existing.response_body)


async def finish(
    session: AsyncSession, *, key_id: uuid.UUID, status: int, body: dict[str, Any]
) -> None:
    await idempotency_repo.complete(session, key_id=key_id, status=status, body=body)
