#!/usr/bin/env bash
# PreToolUse(Bash): защита от записи в защищённые пути через shell.
# Логика вынесена в guard_command.py — разбор команды на сегменты и определение
# «читает или пишет» на регулярках bash получался дырявым (см. комментарий в .py).
# Exit 2 = блок, stderr уходит агенту.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$DIR/guard_command.py"
