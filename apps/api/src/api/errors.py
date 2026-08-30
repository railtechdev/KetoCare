"""Единый формат ошибок API (раздел 5.1 ТЗ).

Ответ: {"error": {"code": "...", "message": "строка для пользователя (ru)", "details": {...}}}
Коды фиксированы разделом 5.1 — новые добавляются только через ADR.
"""

from __future__ import annotations

from enum import StrEnum
from http import HTTPStatus
from typing import Any

import structlog
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = structlog.get_logger(__name__)


class ErrorCode(StrEnum):
    VALIDATION_ERROR = "validation_error"
    UNAUTHORIZED = "unauthorized"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    INFEASIBLE_CALCULATION = "infeasible_calculation"
    RATE_LIMITED = "rate_limited"
    INTERNAL = "internal"


_STATUS_BY_CODE = {
    ErrorCode.VALIDATION_ERROR: status.HTTP_422_UNPROCESSABLE_CONTENT,
    ErrorCode.UNAUTHORIZED: status.HTTP_401_UNAUTHORIZED,
    ErrorCode.FORBIDDEN: status.HTTP_403_FORBIDDEN,
    ErrorCode.NOT_FOUND: status.HTTP_404_NOT_FOUND,
    ErrorCode.CONFLICT: status.HTTP_409_CONFLICT,
    ErrorCode.INFEASIBLE_CALCULATION: status.HTTP_422_UNPROCESSABLE_CONTENT,
    ErrorCode.RATE_LIMITED: status.HTTP_429_TOO_MANY_REQUESTS,
    ErrorCode.INTERNAL: status.HTTP_500_INTERNAL_SERVER_ERROR,
}


class ApiError(Exception):
    """Прикладная ошибка, отдаваемая клиенту в формате раздела 5.1 ТЗ."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        details: dict[str, Any] | None = None,
        status_code: int | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.details = details or {}
        self.status_code = status_code or _STATUS_BY_CODE[code]
        self.headers = headers or {}
        super().__init__(message)


def error_response(
    code: ErrorCode,
    message: str,
    *,
    details: dict[str, Any] | None = None,
    status_code: int,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code.value, "message": message, "details": details or {}}},
        headers=headers,
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return error_response(
            exc.code,
            exc.message,
            details=exc.details,
            status_code=exc.status_code,
            headers=exc.headers or None,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(
            ErrorCode.VALIDATION_ERROR,
            "Проверьте правильность заполнения полей.",
            details={"fields": _format_validation_errors(exc)},
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = _map_status(exc.status_code)
        return error_response(code, _custom_detail(exc) or message, status_code=exc.status_code)


def register_unhandled_error_middleware(app: FastAPI) -> None:
    """Превращает непойманное исключение в ответ формата раздела 5.1 ТЗ.

    Реализовано middleware, а не `@app.exception_handler(Exception)`: обработчик
    для `Exception` вызывается Starlette из `ServerErrorMiddleware`, который стоит
    снаружи пользовательских middleware, поэтому его ответ не проходит через CORS —
    браузер увидел бы ошибку CORS вместо тела с кодом `internal`. Middleware же
    регистрируется внутри CORS (см. порядок в main.create_app).
    """

    @app.middleware("http")
    async def _unhandled_error(request: Request, call_next: Any) -> Any:
        try:
            return await call_next(request)
        except Exception:
            # Только тип исключения и путь: str(exc) у ошибок SQLAlchemy содержит
            # текст SQL вместе с параметрами — то есть argon2-хеши, totp_secret,
            # хеши токенов приглашений и ФИО пациентов утекли бы в логи.
            logger.exception(
                "unhandled_error",
                path=request.url.path,
                method=request.method,
            )
            return error_response(
                ErrorCode.INTERNAL,
                "Внутренняя ошибка сервера. Попробуйте позже.",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


def _custom_detail(exc: StarletteHTTPException) -> str | None:
    """Текст из `HTTPException(..., detail="...")`, если его написал человек.

    Брать `detail` безоговорочно нельзя: когда своего текста нет, Starlette
    подставляет туда стандартную фразу статуса по-английски (404 → `Not Found`),
    а раздел 5.1 ТЗ требует сообщение на русском. Поэтому `detail` считается
    своим, только если он отличается от фразы по умолчанию.

    Без этого авторский текст пропадал молча: `HTTPException(404, "Рецепт не
    найден")` доезжал до клиента как обезличенное «Запись не найдена».
    """
    detail = exc.detail
    if not isinstance(detail, str) or not detail.strip():
        return None
    try:
        default_phrase = HTTPStatus(exc.status_code).phrase
    except ValueError:
        # Нестандартный код: фразы по умолчанию для него нет, значит текст свой.
        return detail
    return None if detail == default_phrase else detail


def _format_validation_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    return [
        {"field": ".".join(str(p) for p in err.get("loc", ())[1:]), "message": err.get("msg", "")}
        for err in exc.errors()
    ]


def _map_status(status_code: int) -> tuple[ErrorCode, str]:
    match status_code:
        case status.HTTP_401_UNAUTHORIZED:
            return ErrorCode.UNAUTHORIZED, "Требуется вход в систему."
        case status.HTTP_403_FORBIDDEN:
            return ErrorCode.FORBIDDEN, "Недостаточно прав для этого действия."
        case status.HTTP_404_NOT_FOUND:
            return ErrorCode.NOT_FOUND, "Запись не найдена."
        case status.HTTP_409_CONFLICT:
            return ErrorCode.CONFLICT, "Конфликт данных."
        case status.HTTP_429_TOO_MANY_REQUESTS:
            return ErrorCode.RATE_LIMITED, "Слишком много запросов, попробуйте позже."
        case _:
            return ErrorCode.INTERNAL, "Внутренняя ошибка сервера."
