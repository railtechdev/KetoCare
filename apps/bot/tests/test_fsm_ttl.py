"""Незаконченный сценарий не живёт в Redis вечно (Н11, SECURITY_REVIEW).

В данных сценария — то, что семья успела ввести: свободный текст еды,
подробности приступа, черновик записи (`pending_write`). Проверяется не
настройка, а то, что доходит до Redis: срок у каждой записи состояния и данных.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from aiogram.fsm.storage.base import StorageKey

from bot.main import FSM_TTL, build_storage

pytestmark = pytest.mark.asyncio


class RecordingRedis:
    """Запоминает, с каким сроком пишется каждый ключ."""

    def __init__(self) -> None:
        self.expiry: dict[str, Any] = {}

    async def set(self, key: str, value: str, ex: Any = None) -> None:
        self.expiry[key] = ex

    async def delete(self, key: str) -> None:
        self.expiry.pop(key, None)


async def test_state_and_data_expire() -> None:
    redis = RecordingRedis()
    storage = build_storage(redis)  # type: ignore[arg-type]
    key = StorageKey(bot_id=1, chat_id=42, user_id=42)

    await storage.set_state(key, "Seizure:details")
    await storage.set_data(
        key,
        {"pending_write": {"kind": "seizures", "key": "k", "body": {"notes": "долго"}}},
    )

    assert len(redis.expiry) == 2
    assert all(ex == FSM_TTL for ex in redis.expiry.values()), redis.expiry


def test_ttl_matches_server_idempotency_window() -> None:
    """Черновик записи держит ключ повтора; позже суток сервер его не узнает
    (`core.repositories.idempotency.KEY_TTL` — бот от `core` не зависит, поэтому
    число повторено здесь), и хранить черновик дольше незачем."""

    assert timedelta(hours=24) == FSM_TTL
