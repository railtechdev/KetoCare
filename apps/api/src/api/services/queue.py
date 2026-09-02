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


class TaskTimeout(Exception):
    """Задача не ответила за отведённое время."""


class TaskLost(Exception):
    """Задачу не удалось поставить или её результат не пришёл вовсе."""


async def run(task: str, *args: Any, timeout_s: float) -> Any:
    """Поставить задачу и дождаться результата (раздел 10.1 ТЗ).

    Так работает только `parse_free_text`: ручка `POST /ai/parse` ждёт разбор
    синхронно, потому что родитель стоит у плиты и ждёт ответа сейчас, а не
    поллингом. Всё остальное ставится и забывается — отчёт собирается минуты, и
    держать ради него соединение нечем.

    Возвращается то, что вернула задача. Исключения воркера сюда не
    протаскиваются: `apps/api` не зависит от `apps/worker`, и распаковать его
    классы ей нечем — задача сама возвращает отказ значением.
    """

    pool = await get_pool()
    job = await pool.enqueue_job(task, *args)
    if job is None:
        raise TaskLost(f"Задача {task} не поставлена в очередь")

    try:
        return await job.result(timeout=timeout_s)
    except TimeoutError as error:
        raise TaskTimeout(f"Задача {task} не ответила за {timeout_s} с") from error


async def reset_pool() -> None:
    """Закрыть пул: нужен тестам и корректному завершению процесса."""

    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
