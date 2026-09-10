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
#
#    Правка ОДНИХ ПОЯСНЕНИЙ версии не требует: semver описывает поведение, а
#    комментарий его не меняет. Раньше страж этого не различал и на устаревший
#    docstring предлагал либо соврать patch-версией, либо оставить в расчётном
#    ядре текст, спорящий с кодом. Что считать поясняющей правкой, решает
#    engine_code_changed.py — сравнением синтаксических деревьев; он умеет
#    только снимать требование и при любом сомнении отвечает «изменилось».
#    Сравнение идёт с HEAD, а не с индексом: `git diff` без ревизии показывает
#    только неиндексированное, и после `git add` правка ядра для стража
#    исчезала — ровно в тот момент, когда до коммита остаётся один шаг.
#
#    `constants.py` проверяется НАРАВНЕ с остальными, хотя раньше был исключён
#    целиком. Исключение стоило дорого: в этом файле лежат ВСЕ медицинские
#    константы, и допуск соответствия назначению можно было расширить втрое, не
#    подняв версию и не уронив ни одного теста. Отдельного случая для самого
#    `ENGINE_VERSION` не нужно: правка только его — это изменение программы, и
#    требование «подними версию» она же и удовлетворяет.
#    Bump проверяется ПО ЗНАЧЕНИЮ, а не по строкам диффа. Прежняя проверка
#    (`grep -c '^[+-]ENGINE_VERSION'`) засчитывала любую правку этой строки:
#    смену кавычек и даже ПОНИЖЕНИЕ версии.
#
#    Чего страж не умеет и уметь не может: судить о СОРАЗМЕРНОСТИ. Из
#    синтаксиса не вывести, тянет ли правка на major, — «сняли зажим клетчатки
#    и подняли patch» он пропустит. Это предмет ревью человеком, и полагаться
#    здесь на автоматику нельзя.
#
#    Ещё одно следствие сравнения с HEAD: bump, уже попавший в коммит, следующую
#    правку математики не покрывает. Внутри одного PR за вторым коммитом с
#    математикой страж попросит второй bump — это верно по смыслу, хотя и
#    неожиданно.
VERSION_FILE="packages/keto_engine/src/keto_engine/constants.py"
# Неотслеживаемые файлы `git diff` не показывает, а новый модуль с формулой —
# такая же правка ядра, как и любая другая.
TOUCHED=$(
  {
    git diff HEAD --name-only -- packages/keto_engine/src 2>/dev/null || true
    git ls-files --others --exclude-standard -- packages/keto_engine/src 2>/dev/null || true
  } | sort -u
)
SRC_CHANGED=""
if [ -n "$TOUCHED" ]; then
  # shellcheck disable=SC2086
  SRC_CHANGED=$(python3 "$ROOT/.claude/hooks/engine_code_changed.py" $TOUCHED 2>/dev/null || echo "$TOUCHED")
fi
VERSION_VERDICT=$(python3 "$ROOT/.claude/hooks/engine_version_bumped.py" "$VERSION_FILE" 2>/dev/null || echo "проверка версии не запустилась")

if [ -n "$SRC_CHANGED" ] && [ "$VERSION_VERDICT" != "bumped" ]; then
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
      echo "Причина: $VERSION_VERDICT"
      echo "Изменены: $(echo "$SRC_CHANGED" | tr '\n' ' ')"
      echo
      echo "Правка ОДНИХ пояснений bump'а не требует — страж это различает."
      echo "Сравнение идёт с HEAD: если bump уже в коммите, следующая правка"
      echo "математики попросит следующий."
      echo "СОРАЗМЕРНОСТЬ (patch или major) страж не проверяет — это к ревью."
      ;;
  esac
} >&2

exit 2
