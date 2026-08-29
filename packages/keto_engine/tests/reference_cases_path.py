"""Путь к каталогу эталонных расчётов. Отдельный модуль, а не conftest.py, чтобы
эталонные тесты могли импортировать его напрямую: пакеты `tests` разных
workspace-членов не образуют импортируемых пакетов (нет __init__.py — иначе их
conftest.py конфликтуют по имени модуля)."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
REFERENCE_CASES_DIR = REPO_ROOT / "docs" / "medical" / "reference-cases"
