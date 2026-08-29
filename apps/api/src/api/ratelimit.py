"""Ограничение частоты запросов (раздел 11 ТЗ: `/auth/*` — 5/мин/IP).

Без него `POST /auth/login` открыт для перебора пароля и шестизначного TOTP-кода
(`valid_window=1` расширяет окно до 90 секунд).
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from core.config import get_settings

from .client_address import client_address
from .errors import ErrorCode, error_response

# Ручки, где перебирают секрет (пароль, шестизначный TOTP, токен приглашения):
# строгий лимит раздела 11 ТЗ.
AUTH_RATE_LIMIT = "5/minute"

# Обновление сессии. Раздел 11 ТЗ говорит про `/auth/*` целиком, но применённый
# к refresh буквально этот лимит ломает нормальную работу: SPA дёргает refresh
# при каждой загрузке страницы, и пары перезагрузок хватает, чтобы запереть
# пользователя на минуту — а за одним NAT под лимит попадут все сразу.
# Подбор здесь и не имеет смысла: предъявляется подписанный JWT, а не угадываемый
# секрет; от кражи токена лимит частоты всё равно не защищает.
# Ограничение оставлено, но такое, чтобы ловить только явное злоупотребление.
REFRESH_RATE_LIMIT = "60/minute"

# Ручки бота. Раздел 11 ТЗ задаёт `/auth/*` — 5/мин/IP, но ключ лимита — адрес
# клиента, а у бота он один на всех: процесс один. С общим лимитом 5/мин шестая
# семья в минуту получала бы отказ, а обмен секрета на сессию нужен каждому чату
# не реже раза в пятнадцать минут — то есть канал записи приступов вставал бы
# целиком при считанных десятках привязок.
#
# Ключ по `chat_id` или `link_id` из тела решил бы это точнее, но эти значения
# выбирает тот, кого ограничивают. Поэтому лимит остаётся по адресу и просто
# поднят до величины, за которой стоит уже не работа, а злоупотребление. Подбор
# им и не сдерживается: код живёт 15 минут при 31^8 вариантов, а секрет привязки
# имеет полную машинную энтропию.
BOT_RATE_LIMIT = "120/minute"


def _client_key(request: Request) -> str:
    """Ключ лимита — адрес клиента (см. client_address: X-Forwarded-For учитывается
    только от доверенного прокси, иначе лимит обходится подменой заголовка)."""

    return client_address(request) or "unknown"


def _build_limiter() -> Limiter:
    # Счётчики в Redis, а не в памяти процесса: при нескольких воркерах или
    # репликах in-memory лимит умножается на их число (5/мин превращается в
    # 20/мин на четырёх воркерах) и обнуляется при каждом перезапуске.
    return Limiter(key_func=_client_key, storage_uri=get_settings().redis_url, default_limits=[])


limiter = _build_limiter()


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
