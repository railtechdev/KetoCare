#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit): страж расчётного ядра.
#
# Правило 2 CLAUDE.md: «Keto Engine меняется только вместе с тестами», а падение
# эталона чинится в коде, а не в тесте. Проверял это только CI — то есть спустя
# десятки правок. Здесь ошибка в математике всплывает сразу, пока контекст свежий.
#
# Exit 2 в PostToolUse = текст уходит агенту как обратная связь (правка не
# откатывается: ядро уже изменено, агент обязан довести его до зелёного).
set -uo pipefail

FILE=$(python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)
[ -z "$FILE" ] && exit 0

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REL="${FILE#"$ROOT"/}"

case "$REL" in
  packages/keto_engine/src/*) ;;
  *) exit 0 ;;
esac

cd "$ROOT" || exit 0

FAILED=""

# 1. Эталоны и property-тесты должны остаться зелёными.
if ! OUTPUT=$(uv run pytest packages/keto_engine -q 2>&1); then
  FAILED="tests"
fi

# 2. Изменение математики требует поднятия ENGINE_VERSION (semver).
#    Сравниваем с состоянием в git: правка ядра без bump'а версии оставит
#    сохранённые computed-значения помеченными старой версией движка.
VERSION_FILE="packages/keto_engine/src/keto_engine/constants.py"
SRC_CHANGED=$(git diff --name-only -- packages/keto_engine/src 2>/dev/null | grep -v "$VERSION_FILE" || true)
VERSION_CHANGED=$(git diff -- "$VERSION_FILE" 2>/dev/null | grep -c '^[+-]ENGINE_VERSION' || true)

if [ -n "$SRC_CHANGED" ] && [ "${VERSION_CHANGED:-0}" -eq 0 ]; then
  FAILED="${FAILED:+$FAILED,}version"
fi

[ -z "$FAILED" ] && exit 0

{
  echo "СТРАЖ РАСЧЁТНОГО ЯДРА (правило 2 CLAUDE.md)"
  echo
  case "$FAILED" in
    *tests*)
      echo "Тесты keto_engine не проходят после правки:"
      echo "$OUTPUT" | tail -25
      echo
      echo "Эталон упал — чини КОД ядра, а не эталон. Менять docs/medical/reference-cases"
      echo "можно только по новой версии медицинской спецификации, и делает это человек."
      echo
      ;;
  esac
  case "$FAILED" in
    *version*)
      echo "Исходники ядра изменены, но ENGINE_VERSION в constants.py не поднят."
      echo "Любое изменение математики требует semver-bump: результаты расчётов"
      echo "сохраняются в БД вместе с engine_version, и без bump'а старые и новые"
      echo "значения станут неразличимы."
      echo "Изменены: $(echo "$SRC_CHANGED" | tr '\n' ' ')"
      ;;
  esac
} >&2

exit 2
