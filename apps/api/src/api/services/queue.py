"""Постановка задач в очередь ARQ (раздел 10.1 ТЗ).

API ставит задачу и отдаёт идентификатор; выполняет её воркер. Здесь только
клиент очереди — код воркера сюда не импортируется, иначе weasyprint и его
системные библиотеки понадобились бы и веб-процессу.

Пул создаётся лениво и переиспользуется: соединение на каждый запрос съедало бы
время ответа, а держать его всегда открытым незачем — очередью пользуются не все
ручки.
"""

from __future__ import annotations

from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from core.config import Settings

_pool: ArqRedis | None = None


async def get_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        settings = Settings()  # type: ignore[call-arg]
        _pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    return _pool


async def enqueue(task: str, *args: Any) -> None:
    pool = await get_pool()
    await pool.enqueue_job(task, *args)


async def reset_pool() -> None:
    """Закрыть пул: нужен тестам и корректному завершению процесса."""

    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
