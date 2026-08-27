"""Ограничение частоты запросов (раздел 11 ТЗ: `/auth/*` — 5/мин/IP).

Без него `POST /auth/login` открыт для перебора пароля и шестизначного TOTP-кода
(окно valid_window=1 расширяет его до 90 секунд).
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from .errors import ErrorCode, error_response

AUTH_RATE_LIMIT = "5/minute"


def _client_key(request: Request) -> str:
    """Ключ лимита — IP клиента. За обратным прокси берётся первый элемент
    X-Forwarded-For (nginx обязан его перезаписывать, иначе значение подделывается)."""

    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(key_func=_client_key, default_limits=[])


def register_rate_limiting(app: FastAPI) -> None:
    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limited(_: Request, __: RateLimitExceeded) -> JSONResponse:
        return error_response(
            ErrorCode.RATE_LIMITED,
            "Слишком много попыток. Подождите минуту и попробуйте снова.",
            status_code=429,
        )
