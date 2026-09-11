"""Заголовок `Idempotency-Key` (ADR-0035)."""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import Depends, Header

from ..errors import ApiError, ErrorCode

#: Видимые символы ASCII без пробелов, до 255: так ключ безопасно ложится в
#: столбец и журнал. Клиенты кабинета шлют UUID.
_KEY = re.compile(r"^[\x21-\x7e]{1,255}$")


async def idempotency_key(
    key: Annotated[
        str | None,
        Header(
            alias="Idempotency-Key",
            description=(
                "Уникальный ключ попытки записи. Повтор с тем же ключом и тем же "
                "телом получает прежний ответ, а не вторую запись (ADR-0035)."
            ),
        ),
    ] = None,
) -> str | None:
    if key is None:
        return None
    if not _KEY.fullmatch(key):
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Ключ повторной отправки должен быть из видимых символов ASCII, до 255.",
            details={"header": "Idempotency-Key"},
        )
    return key


IdempotencyKeyDep = Annotated[str | None, Depends(idempotency_key)]
