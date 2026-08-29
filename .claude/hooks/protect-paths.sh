#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit): блокирует правки защищённых путей.
# Список путей и причины — в guard_command.py, общем с protect-bash.sh: две копии
# списка (bash + регулярки) неизбежно разошлись бы.
# Exit 2 = блок, stderr уходит агенту.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$DIR/guard_command.py" file
