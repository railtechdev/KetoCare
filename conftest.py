"""Общая подготовка прогона тестов.

Лежит в корне, потому что адрес базы нужен и `apps/api/tests`, и
`packages/core/tests`, а решаться он должен один раз и одинаково.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Приложение читает `.env` через pydantic-settings, а conftest'ы смотрели прямо
# в окружение — и `make test` уходил не в ту базу, потому что переменная там не
# выставлена. Уже заданное окружение (CI) имеет приоритет: override=False.
load_dotenv(Path(__file__).parent / ".env", override=False)

# Один канонический адрес для всех тестов, использующих БД.
_configured = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
if _configured:
    os.environ["TEST_DATABASE_URL"] = _configured
