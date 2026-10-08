"""`/health/ai` — состояние ИИ-подсистемы для монитора доступности.

Читает её только `infra/scripts/uptime_check.py` (`.github/workflows/uptime.yml`),
поэтому ручка устроена не как остальные:

- **не пользовательская.** Ни сессии, ни роли: монитор — не человек, и
  заводить ему учётную запись значило бы заводить вход, который никто не
  охраняет. Вместо этого отдельный токен `MONITOR_TOKEN`, сравнение — за
  постоянное время (`hmac.compare_digest`);
- **без токена на стенде её нет.** Пустая или короткая настройка — 404 тем же
  ответом, что у несуществующего адреса: открытая ручка рассказывала бы
  кому угодно, работает ли у клиники ИИ и когда он сломался;
- **в OpenAPI её нет**: кабинету, боту и Mini App она не нужна, и
  генерировать под неё клиента незачем;
- **данных пациентов в ответе нет**: только счёт, время и класс ошибки
  (`services/ai_health.py`).

nginx отдельного правила не требует: `/api/` кабинета уже проксируется целиком.
"""

from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Request
from starlette.exceptions import HTTPException as StarletteHTTPException

from core.config import get_settings

from ..deps.auth import SessionDep
from ..errors import ApiError, ErrorCode
from ..schemas_health import AiHealth
from ..services import ai_health as ai_health_service

#: Короче — ручка выключена: токен такой длины подбирается.
MONITOR_TOKEN_MIN_LENGTH = 32

MONITOR_TOKEN_HEADER = "X-Monitor-Token"


def _presented_token(request: Request) -> str:
    scheme, _, value = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() == "bearer" and value.strip():
        return value.strip()
    return request.headers.get(MONITOR_TOKEN_HEADER, "").strip()


def require_monitor_token(request: Request) -> None:
    expected = get_settings().monitor_token
    if len(expected) < MONITOR_TOKEN_MIN_LENGTH:
        # Без detail — ровно тот ответ, что получает несуществующий адрес.
        raise StarletteHTTPException(status_code=404)
    presented = _presented_token(request)
    # Сравниваются байты: compare_digest на str с не-ASCII символами падает
    # TypeError, а заголовок присылает кто угодно.
    if not presented or not hmac.compare_digest(presented.encode(), expected.encode()):
        raise ApiError(ErrorCode.UNAUTHORIZED, "Токен монитора недействителен.")


router = APIRouter(
    prefix="/health",
    tags=["service"],
    include_in_schema=False,
    dependencies=[Depends(require_monitor_token)],
)


@router.get("/ai", response_model=AiHealth, summary="Состояние ИИ-подсистемы")
async def health_ai(session: SessionDep) -> AiHealth:
    return await ai_health_service.ai_health(session, get_settings())
