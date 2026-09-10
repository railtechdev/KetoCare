"""Поднята ли `ENGINE_VERSION` относительно HEAD — по значению, а не по диффу.

**Зачем.** `engine-guard.sh` требовал bump'а, считая строки диффа
(`grep -c '^[+-]ENGINE_VERSION'`). Требование выполняла ЛЮБАЯ правка этой
строки: смена кавычек `"1.0.0"` → `'1.0.0'` засчитывалась как поднятая версия,
понижение `1.0.0` → `0.9.9` — тоже. То есть проверка ловила не то, о чём
говорила.

**Как.** Значение берётся из HEAD и из рабочей копии, оба разбираются как
semver и сравниваются как кортежи чисел. Годится только строгий рост.

Проверка **строгая намеренно**: она не умеет снимать требование, только
подтверждать его. Не разобралось — не подтверждено.

Печатает `bumped`, если версия выросла, иначе строку с причиной. Код возврата
0 в обоих случаях: решение принимает вызывающий скрипт.

Чего эта проверка НЕ делает: она не судит о СОРАЗМЕРНОСТИ. Из синтаксиса
не вывести, тянет ли правка на major; «сняли зажим клетчатки и подняли patch»
она пропустит. Соразмерность — предмет ревью, и на страж тут полагаться нельзя.

Аргумент: путь к `constants.py` относительно корня репозитория.
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys

_PATTERN = re.compile(r"""^ENGINE_VERSION\s*[:=][^=]*?["']([^"']+)["']""", re.MULTILINE)


def _parse(source: str) -> tuple[int, ...] | None:
    """Версия из текста файла кортежем чисел. `None` — не нашли или не число."""

    found = _PATTERN.search(source)
    if found is None:
        return None
    parts = found.group(1).split(".")
    try:
        return tuple(int(part) for part in parts)
    except ValueError:
        return None


def _blob_at_head(path: str) -> str | None:
    completed = subprocess.run(
        ["git", "show", f"HEAD:{path}"],
        capture_output=True,
        text=True,
        check=False,
    )
    return completed.stdout if completed.returncode == 0 else None


def verdict(path: str) -> str:
    before_source = _blob_at_head(path)
    if before_source is None:
        return "bumped"  # файла ещё не было в git — сравнивать не с чем

    try:
        after_source = pathlib.Path(path).read_text(encoding="utf-8")
    except OSError:
        return f"не прочитать {path}"

    before = _parse(before_source)
    after = _parse(after_source)
    if before is None:
        return f"в HEAD:{path} не нашлась ENGINE_VERSION — изменилось имя константы?"
    if after is None:
        return f"в {path} не нашлась ENGINE_VERSION или она не число"
    if after == before:
        return f"ENGINE_VERSION осталась {'.'.join(map(str, before))}"
    if after < before:
        return (
            f"ENGINE_VERSION ПОНИЖЕНА: {'.'.join(map(str, before))} → "
            f"{'.'.join(map(str, after))}. Сохранённые расчёты помечаются этой строкой, "
            "и понижение делает старые и новые значения неразличимыми"
        )
    return "bumped"


def main(argv: list[str]) -> int:
    if not argv:
        print("нужен путь к constants.py")
        return 0
    print(verdict(argv[0]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
