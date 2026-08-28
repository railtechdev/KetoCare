#!/usr/bin/env python3
"""Анализ Bash-команды на запись в защищённые пути.

Принцип — fail-closed: если в команде упомянут защищённый путь, она блокируется,
пока не доказано, что каждый её сегмент только читает. Обратный принцип
(«блокировать по списку опасных шаблонов») неизбежно дырявый: запись возможна
через python3 -c, node -e, perl -pi, cd в каталог, подстановку переменной —
перечислить все способы нельзя.

Хук защищает от НЕОСТОРОЖНОСТИ, а не от намеренного обхода: закодировать команду
в base64 и выполнить всё равно можно. Задача — чтобы правки медицинских данных
и миграций не происходили мимоходом, незаметно для человека.

Вход: JSON от Claude Code на stdin. Выход: 0 — разрешить, 2 — заблокировать.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import sys

# --- защищённые пути -------------------------------------------------------
# Единственное место, где перечислены пути для Bash-хука. Правила Edit/Write
# живут в lib-protected.sh; списки обязаны совпадать — см. тест hooks.

PROTECTED_DIRS = (
    # Медицинские спецификации и эталоны — только медицинская команда (ТЗ §0.1)
    "docs/medical",
    # Закоммиченные Alembic-миграции не правятся (ТЗ §0.3)
    "migrations/versions",
    "alembic/versions",
    # Сами хуки: защита, которую агент может снести, — не защита
    ".claude/hooks",
)

PROTECTED_FILES = (".claude/settings.json",)

# Каталог считается упомянутым и без завершающего слэша: иначе `cd docs/medical`
# проходил бы мимо проверки, а следующий сегмент писал бы относительным путём.
PROTECTED_RE = re.compile(
    "|".join(re.escape(d) + r"(?:/|\b)" for d in PROTECTED_DIRS)
    + "|"
    + "|".join(re.escape(f) for f in PROTECTED_FILES)
)

# Исключения: агент обязан писать вопросы медкоманде и переменные окружения-примеры
ALLOWED = (
    "docs/medical/OPEN_QUESTIONS.md",
    ".env.example",
)

# .env обрабатывается отдельно: как отдельное слово, чтобы .env.example и
# упоминания вида "environment" не считались совпадением.
ENV_RE = re.compile(r"(^|[\s\"'/=])\.env(\.[A-Za-z0-9_-]+)?([\s\"';&|)]|$)")

# --- команды, которые заведомо только читают -------------------------------
READ_ONLY = {
    "cat",
    "bat",
    "head",
    "tail",
    "less",
    "more",
    "nl",
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "ack",
    "ls",
    "ll",
    "tree",
    "find",
    "stat",
    "file",
    "du",
    "wc",
    "basename",
    "dirname",
    "sort",
    "uniq",
    "cut",
    "column",
    "diff",
    "cmp",
    "md5",
    "md5sum",
    "shasum",
    "echo",
    "printf",
    "true",
    "test",
    "which",
    "type",
    "jq",
    "yq",
    "date",
    "pwd",
    "env",
}

# git — только читающие подкоманды
GIT_READ_ONLY = {"log", "diff", "show", "status", "ls-files", "blame", "cat-file", "rev-parse"}


def mentions_protected(text: str) -> bool:
    masked = text
    for allowed in ALLOWED:
        masked = masked.replace(allowed, "@ALLOWED@")
    if PROTECTED_RE.search(masked):
        return True
    return bool(ENV_RE.search(masked))


def split_segments(command: str) -> list[str]:
    """Разбивает команду на сегменты по ; && || | & и переводам строк."""
    return [s for s in re.split(r"(?:\|\||&&|[;|&\n])", command) if s.strip()]


def first_word(segment: str) -> str:
    """Имя команды сегмента без присваиваний окружения и обёрток."""
    try:
        tokens = shlex.split(segment, posix=True)
    except ValueError:
        # Незакрытая кавычка (частый случай — heredoc): считаем неизвестной командой
        tokens = segment.split()

    skip_prefix = {"sudo", "command", "nohup", "time", "xargs", "nice"}
    for token in tokens:
        if "=" in token and not token.startswith("-") and "/" not in token.split("=")[0]:
            continue  # FOO=bar
        if token in skip_prefix:
            continue
        return token.rsplit("/", maxsplit=1)[-1]
    return ""


def segment_is_read_only(segment: str) -> bool:
    # Любое перенаправление вывода делает сегмент пишущим
    if re.search(r"(?<![0-9<>])>>?", segment):
        return False

    name = first_word(segment)
    if not name:
        return False

    if name == "git":
        try:
            tokens = shlex.split(segment, posix=True)
        except ValueError:
            return False
        subcommands = [t for t in tokens[1:] if not t.startswith("-")]
        return bool(subcommands) and subcommands[0] in GIT_READ_ONLY

    # cd в защищённый каталог открывает запись относительными путями дальше
    if name == "cd":
        return not mentions_protected(segment)

    return name in READ_ONLY


BLOCK_MESSAGE = """BLOCKED: команда затрагивает защищённый путь и не распознана как read-only.

Защищено:
  docs/medical/*            — спецификации и эталоны меняет медицинская команда (ТЗ §0.1, правило 1)
  */migrations/versions/*   — закоммиченная миграция не правится, создаётся новая (ТЗ §0.3, правило 3)
  .env                      — секреты редактирует человек (правило 7)
  .claude/hooks/, settings.json — защита не отключается агентом

Разрешено без ограничений:
  docs/medical/OPEN_QUESTIONS.md — вопросы и допущения пиши сюда
  .env.example                   — новые переменные объявляй здесь

Проверка идёт по принципу «запрещено, пока не доказано чтение»: python3/node/perl и
подобное считаются пишущими, даже если в конкретном случае только читают.

Что делать:
  • читаешь — используй cat/grep/ls/head (они разрешены);
  • нужна новая миграция — cd packages/core && uv run alembic revision --autogenerate -m "..."
  • правка действительно нужна — попроси пользователя выполнить её самому."""


FILE_BLOCK_TEMPLATE = """BLOCKED: {reason}

Разрешено без ограничений:
  docs/medical/OPEN_QUESTIONS.md — вопросы и допущения медицинской команде
  .env.example                   — объявление новых переменных окружения"""


def file_block_reason(file_path: str) -> str | None:
    """Причина блокировки правки файла, либо None."""
    root = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    rel = file_path
    if rel.startswith(root + os.sep):
        rel = rel[len(root) + 1 :]
    # removeprefix, а не lstrip: lstrip("./") срезает ВСЕ ведущие точки и слэши,
    # превращая ".env" в "env" и ".claude/hooks/x" в "claude/hooks/x" — защита
    # молча переставала срабатывать ровно на тех путях, ради которых написана.
    rel = rel.removeprefix("./")

    if rel in ALLOWED:
        return None

    if rel.startswith("docs/medical/"):
        return (
            f"{rel} — медицинские спецификации и эталоны меняет только медицинская команда "
            "(ТЗ §0.1, правило 1 CLAUDE.md). Вопросы и допущения пиши в "
            "docs/medical/OPEN_QUESTIONS.md; новые provisional-эталоны согласуй с человеком."
        )

    if re.search(r"(^|/)(migrations|alembic)/versions/.*\.py$", rel):
        # Свежесозданная ревизия ещё не в индексе — её правка легитимна.
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", rel],
            cwd=os.environ.get("CLAUDE_PROJECT_DIR", "."),
            capture_output=True,
        )
        if tracked.returncode == 0:
            return (
                f"{rel} — закоммиченная миграция не правится (ТЗ §0.3, правило 3 CLAUDE.md). "
                'Создай новую ревизию: cd packages/core && uv run alembic revision --autogenerate -m "..."'
            )
        return None

    if rel == ".env" or rel.startswith(".env."):
        return f"{rel} — файлы с секретами редактирует человек (правило 7). Меняй .env.example."

    if rel.startswith(".claude/hooks/") or rel == ".claude/settings.json":
        return (
            f"{rel} — защита, которую агент может отключить сам, защитой не является. "
            "Если правка хуков действительно нужна, попроси пользователя внести её "
            "или временно отключить хуки."
        )

    return None


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "command"

    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    if mode == "file":
        file_path = payload.get("tool_input", {}).get("file_path", "")
        if not file_path:
            return 0
        reason = file_block_reason(file_path)
        if reason:
            print(FILE_BLOCK_TEMPLATE.format(reason=reason), file=sys.stderr)
            return 2
        return 0

    command = payload.get("tool_input", {}).get("command", "")
    if not command or not mentions_protected(command):
        return 0

    for segment in split_segments(command):
        if mentions_protected(segment) and not segment_is_read_only(segment):
            print(BLOCK_MESSAGE, file=sys.stderr)
            return 2

    # Путь упомянут, но каждый сегмент, где он встречается, только читает.
    # Отдельно ловим случай, когда защищённый путь «внесён» через cd, а пишет
    # следующий сегмент уже относительным путём.
    segments = split_segments(command)
    if any(first_word(s) == "cd" and mentions_protected(s) for s in segments):
        print(BLOCK_MESSAGE, file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
