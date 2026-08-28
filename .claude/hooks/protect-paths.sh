#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit|NotebookEdit): блокирует правки защищённых путей.
# Exit 2 = блок, stderr уходит агенту.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-protected.sh
source "$DIR/lib-protected.sh"

FILE=$(python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)
[ -z "$FILE" ] && exit 0

if REASON=$(protected_reason "$FILE"); then
  echo "BLOCKED: $REASON" >&2
  exit 2
fi

exit 0
