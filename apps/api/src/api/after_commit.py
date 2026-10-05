"""Задачи очереди, которые уходят только после коммита запроса.

Постановка в очередь внутри транзакции обещает то, чего ещё нет: воркер может
выполнить задачу раньше коммита, а транзакция — откатиться после. Для
уведомления семьи это значит «подключился новый близкий» о подключении,
которого не случилось (находка ревью ADR-0043): гонка двух кодов на один чат
откатывает активацию уже после того, как задача ушла.

Сервис откладывает задачу на сессию (`defer`), а `get_session` отправляет её
после `commit` или выбрасывает при откате. Отказ очереди не роняет ответ:
запись уже сохранена, а задача — вторичное следствие.
"""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from .services import queue as queue_service

logger = structlog.get_logger(__name__)

_KEY = "after_commit_tasks"


def defer(session: AsyncSession, task: str, *args: Any) -> None:
    """Поставить задачу в очередь, когда (и если) запрос закоммитится."""

    session.info.setdefault(_KEY, []).append((task, args))


async def run_deferred(session: AsyncSession) -> None:
    """Отправить отложенное. Вызывается после успешного коммита."""

    for task, args in session.info.pop(_KEY, []):
        try:
            await queue_service.enqueue(task, *args)
        except Exception as exc:  # noqa: BLE001 — запись сохранена, задача вторична
            logger.warning("deferred_task_not_queued", task=task, reason=str(exc))


def discard(session: AsyncSession) -> None:
    """Забыть отложенное: транзакция откатилась, обещать нечего."""

    session.info.pop(_KEY, None)
