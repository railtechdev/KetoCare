"""Заголовок `Idempotency-Key` (ADR-0035)."""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import Depends, Header

from ..errors import ApiError, ErrorCode

#: Видимые символы ASCII без пробела, кавычки и обратной косой черты, до 255:
#: так ключ безопасно ложится в столбец и журнал. Рекомендуется UUID.
_KEY = re.compile(r"^[\x21\x23-\x5b\x5d-\x7e]{1,255}$")
#: Черновик IETF (draft-ietf-httpapi-idempotency-key-header-07, раздел 2)
#: задаёт значение строкой структурированного заголовка — в кавычках:
#: `Idempotency-Key: "8e03978e-…"`. Stripe и многие клиенты шлют ключ без
#: кавычек. Обе формы — один и тот же ключ, иначе `"abc"` и `abc` разошлись бы.
_QUOTED = re.compile(r'^"(.*)"$')


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
    quoted = _QUOTED.fullmatch(key)
    if quoted is not None:
        key = quoted.group(1)
    if not _KEY.fullmatch(key):
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Ключ повторной отправки должен быть из видимых символов ASCII без кавычек внутри, до 255.",
            details={"header": "Idempotency-Key"},
        )
    return key


IdempotencyKeyDep = Annotated[str | None, Depends(idempotency_key)]
