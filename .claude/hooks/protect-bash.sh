#!/usr/bin/env bash
# PreToolUse(Bash): та же защита, что и для Edit/Write, но для записи через shell
# (sed -i, редиректы, rm/mv/cp/tee, git checkout --). Без этого хука защита обходится
# одной командой `sed -i ... docs/medical/...`.
# Эвристика: блокируем, только если защищённый путь стоит в позиции цели записи.
# Чтение (cat/grep/ls) не блокируется. Exit 2 = блок.
set -uo pipefail

CMD=$(python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("tool_input",{}).get("command",""))' 2>/dev/null || true)
[ -z "$CMD" ] && exit 0

# Разрешённые исключения выводим из-под регулярок заменой на плейсхолдеры.
SCAN="${CMD//docs\/medical\/OPEN_QUESTIONS.md/OPENQUESTIONS_ALLOWED}"
SCAN="${SCAN//.env.example/ENVEXAMPLE_ALLOWED}"

PROT='(docs/medical/|migrations/versions/|alembic/versions/|(^|[[:space:]"'"'"'/])\.env([[:space:]"'"'"';&|]|$))'
REDIRECT='>>?[[:space:]]*[^[:space:];&|]*'"$PROT"
SEDINPLACE='sed[[:space:]][^;&|]*-i[^;&|]*'"$PROT"
FILECMD='(^|[;&|][[:space:]]*)(rm|mv|cp|tee|truncate|dd|patch|install|chmod|chown)[[:space:]][^;&|]*'"$PROT"
GITCMD='git[[:space:]]+[^;&|]*(checkout|restore|clean|rm)[^;&|]*'"$PROT"

for RE in "$REDIRECT" "$SEDINPLACE" "$FILECMD" "$GITCMD"; do
  if [[ "$SCAN" =~ $RE ]]; then
    cat >&2 <<'MSG'
BLOCKED: команда пишет в защищённый путь (docs/medical/*, миграции в */versions/*.py, .env).
Правила: медицинские спецификации и эталоны меняет только медицинская команда (ТЗ §0.1);
закоммиченная миграция не правится — создаётся новая ревизия (ТЗ §0.3); .env редактирует человек.
Вопросы и допущения пиши в docs/medical/OPEN_QUESTIONS.md, переменные — в .env.example.
Если это ложное срабатывание (путь используется только для чтения) — разнеси чтение и запись
на две команды или попроси пользователя выполнить операцию самостоятельно.
MSG
    exit 2
  fi
done

exit 0
