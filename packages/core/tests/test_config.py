"""Проверки конфигурации (раздел 12 ТЗ)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from core.config import SECRET_KEY_MIN_LENGTH, Settings

_BASE = {
    "database_url": "postgresql+asyncpg://u:p@localhost:5432/db",
    "redis_url": "redis://localhost:6379/0",
}


def test_short_secret_key_rejected() -> None:
    """Слабый ключ подписи JWT — уязвимость, а не предупреждение: токен открывает
    доступ к клиническим данным ребёнка."""

    with pytest.raises(ValidationError):
        Settings(**_BASE, secret_key="dev-secret-change-me")


def test_secret_key_of_minimum_length_accepted() -> None:
    settings = Settings(**_BASE, secret_key="x" * SECRET_KEY_MIN_LENGTH)
    assert len(settings.secret_key) == SECRET_KEY_MIN_LENGTH
