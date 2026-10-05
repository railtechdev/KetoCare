"""Счётчик неудачных входов по учётной записи (аудит блокеров, E2 и E8).

Лимит частоты по адресу (`ratelimit.py`) защищает от перебора с одной машины,
но считает каждое обращение — и успешные шаги тоже. Вход врача — два обращения
(пароль, затем код), и за общим адресом клиники третий сотрудник в ту же минуту
получал отказ. А перебор с разных адресов по одной учётной записи он не видел
вовсе.

NIST SP 800-63B велит ограничивать именно НЕУДАЧНЫЕ попытки, и именно для
учётной записи. Здесь — десять неудач за пятнадцать минут: живой человек столько
не ошибается, а подбор упирается в стену. Порог держит и паролем, и кодом
второго фактора: оба — секреты одной учётной записи.

Счётчики в Redis, как и у лимита по адресу. Недоступный Redis вход не закрывает:
счётчик в памяти процесса слабее, но закрытая дверь для врача на приёме хуже.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable
from typing import cast

import structlog
from redis.asyncio import Redis

from core.config import get_settings

logger = structlog.get_logger(__name__)

MAX_FAILURES = 10
WINDOW_SECONDS = 15 * 60

_PREFIX = "login-failures:"
_memory: dict[str, list[float]] = {}
_redis: Redis | None = None


def _key(account: str) -> str:
    return _PREFIX + account.strip().lower()


def _client() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(get_settings().redis_url)
    return _redis


async def is_locked(account: str) -> bool:
    """Учётная запись упёрлась в порог неудач."""

    try:
        count = await cast(Awaitable[int | None], _client().get(_key(account)))
        return int(count or 0) >= MAX_FAILURES
    except Exception as exc:  # noqa: BLE001 — счётчик не условие входа
        logger.warning("login_throttle_unavailable", reason=str(exc))
        return len(_recent(account)) >= MAX_FAILURES


async def record_failure(account: str) -> None:
    key = _key(account)
    try:
        client = _client()
        count = await cast(Awaitable[int], client.incr(key))
        if count == 1:
            await cast(Awaitable[bool], client.expire(key, WINDOW_SECONDS))
    except Exception as exc:  # noqa: BLE001
        logger.warning("login_throttle_unavailable", reason=str(exc))
        _recent(account).append(time.monotonic())


async def reset(account: str) -> None:
    """Успешный вход обнуляет счётчик: ошибки до него — не перебор."""

    _memory.pop(_key(account), None)
    try:
        await cast(Awaitable[int], _client().delete(_key(account)))
    except Exception as exc:  # noqa: BLE001
        logger.warning("login_throttle_unavailable", reason=str(exc))


def _recent(account: str) -> list[float]:
    now = time.monotonic()
    stamps = [t for t in _memory.get(_key(account), []) if now - t < WINDOW_SECONDS]
    _memory[_key(account)] = stamps
    return stamps
