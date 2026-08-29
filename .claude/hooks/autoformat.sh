#!/usr/bin/env bash
# PostToolUse(Edit|Write): автоформат изменённого файла. Никогда не падает и ничего не блокирует.
FILE=$(python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)
[ -z "$FILE" ] && exit 0
[ -f "$FILE" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REL="${FILE#"$ROOT"/}"

# Рукописные документы (ТЗ, ADR, мед. доки, README) prettier не трогает — иначе диффы
# забиваются переформатированием русского markdown.
case "$REL" in
  docs/*|*.md) exit 0 ;;
esac

case "$FILE" in
  *.py)  uv run ruff format "$FILE" >/dev/null 2>&1; uv run ruff check --fix "$FILE" >/dev/null 2>&1 ;;
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css) pnpm exec prettier --write "$FILE" >/dev/null 2>&1 ;;
esac
exit 0
