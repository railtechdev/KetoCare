"""Счётчик неудачных входов (аудит блокеров, E2 и E8).

Лимит частоты по адресу (`ratelimit.py`) защищает от потока с одной машины, но
считал каждое обращение — и успешные шаги тоже: вход врача — два обращения
(пароль, затем код), и за общим адресом клиники третий сотрудник в ту же минуту
получал отказ. Перебор с разных адресов по одной учётной записи он не видел вовсе.

NIST SP 800-63B велит ограничивать именно НЕУДАЧНЫЕ попытки по учётной записи и
не давать злоумышленнику запирать чужую учётную запись. Отсюда два счётчика:

- **почта + адрес** — 10 неудач за 15 минут. Подбор с одной машины упирается в
  стену, а врач, входящий из клиники, этой стены не видит: злоумышленник,
  знающий его почту, запирает только собственный адрес;
- **почта** — 50 неудач за 15 минут, с любых адресов. Потолок для
  распределённого перебора; держать его требует десятков адресов.

Порог держит и паролем, и кодом второго фактора: оба — секреты одной учётной
записи. Почта в ключе — хешем: ключи Redis видны всякому, кто смотрит в него.

Счётчики в Redis, как и у лимита по адресу. Недоступный Redis вход не закрывает:
счётчик в памяти процесса слабее, но закрытая дверь для врача на приёме хуже.
"""

from __future__ import annotations

import hashlib
import time
from collections.abc import Awaitable
from typing import cast

import structlog
from redis.asyncio import Redis

from core.config import get_settings

logger = structlog.get_logger(__name__)

MAX_FAILURES_PER_ADDRESS = 10
MAX_FAILURES_PER_ACCOUNT = 50
WINDOW_SECONDS = 15 * 60
#: Запасной счётчик в памяти — не больше стольких ключей: без предела перебор
#: случайных адресов почты во время отказа Redis растил бы его без конца.
_MEMORY_LIMIT = 10_000

_PREFIX = "login-failures:"
_memory: dict[str, list[float]] = {}
_redis: Redis | None = None


def account_tag(account: str) -> str:
    """Хеш почты — для ключей и журнала, без самой почты."""

    return hashlib.sha256(account.strip().lower().encode()).hexdigest()[:24]


def _keys(account: str, address: str | None) -> tuple[str, str]:
    tag = account_tag(account)
    return f"{_PREFIX}{tag}:{address or 'unknown'}", f"{_PREFIX}{tag}"


def _client() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(get_settings().redis_url)
    return _redis


async def is_locked(account: str, address: str | None) -> bool:
    """Упёрлась ли пара «почта + адрес» или сама почта в порог неудач."""

    pair, whole = _keys(account, address)
    try:
        client = _client()
        pair_count = int(await cast(Awaitable[int | None], client.get(pair)) or 0)
        whole_count = int(await cast(Awaitable[int | None], client.get(whole)) or 0)
    except Exception as exc:  # noqa: BLE001 — счётчик не условие входа
        logger.warning("login_throttle_unavailable", reason=str(exc))
        pair_count, whole_count = len(_recent(pair)), len(_recent(whole))
    locked = pair_count >= MAX_FAILURES_PER_ADDRESS or whole_count >= MAX_FAILURES_PER_ACCOUNT
    if locked:
        # Без записи администратор не узнал бы, что учётную запись держат
        # запертой. Почта — хешем.
        logger.warning(
            "login_locked",
            account=account_tag(account),
            per_address=pair_count,
            per_account=whole_count,
        )
    return locked


async def record_failure(account: str, address: str | None) -> None:
    for key in _keys(account, address):
        try:
            client = _client()
            count = await cast(Awaitable[int], client.incr(key))
            if count == 1:
                await cast(Awaitable[bool], client.expire(key, WINDOW_SECONDS))
        except Exception as exc:  # noqa: BLE001
            logger.warning("login_throttle_unavailable", reason=str(exc))
            _recent(key).append(time.monotonic())


async def reset(account: str) -> None:
    """Обнулить счётчики учётной записи: успешный вход или временный пароль.

    Сбрасываются и счётчик по почте, и пары со всеми адресами: после выдачи
    временного пароля человек должен войти сразу, откуда бы ни входил.
    """

    tag = account_tag(account)
    for key in [k for k in _memory if k.startswith(f"{_PREFIX}{tag}")]:
        _memory.pop(key, None)
    try:
        client = _client()
        keys = [key async for key in client.scan_iter(match=f"{_PREFIX}{tag}*")]
        if keys:
            await cast(Awaitable[int], client.delete(*keys))
    except Exception as exc:  # noqa: BLE001
        logger.warning("login_throttle_unavailable", reason=str(exc))


def _recent(key: str) -> list[float]:
    now = time.monotonic()
    stamps = [t for t in _memory.get(key, []) if now - t < WINDOW_SECONDS]
    if key not in _memory and len(_memory) >= _MEMORY_LIMIT:
        _memory.clear()
    _memory[key] = stamps
    return stamps
