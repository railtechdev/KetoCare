#!/usr/bin/env bash
# Общий список защищённых путей для хуков protect-paths.sh (Edit/Write) и protect-bash.sh (Bash).
# Единственное место, где этот список определён — не дублируй его в других скриптах.

# protected_reason <относительный-путь>
# Печатает причину блокировки в stdout и возвращает 0, если путь защищён; иначе возвращает 1.
protected_reason() {
  local rel="$1"
  local root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
  rel="${rel#"$root"/}"
  rel="${rel#./}"

  # 1. Медицинские спецификации и эталоны — только медицинская команда (ТЗ §0.1).
  #    Исключение: OPEN_QUESTIONS.md — агент обязан туда писать вопросы.
  if [[ "$rel" == docs/medical/* && "$rel" != docs/medical/OPEN_QUESTIONS.md ]]; then
    echo "$rel — медицинская спецификация/эталоны меняются только медицинской командой (ТЗ §0.1, правило 1 CLAUDE.md). Вопросы и допущения — в docs/medical/OPEN_QUESTIONS.md; новые provisional-эталоны обсуди с человеком."
    return 0
  fi

  # 2. Уже закоммиченные Alembic-миграции не правятся (ТЗ §0.3, правило 3 CLAUDE.md).
  #    Реальный путь в репозитории — packages/core/migrations/versions/.
  if [[ "$rel" == */migrations/versions/*.py || "$rel" == */alembic/versions/*.py ]]; then
    if git -C "${CLAUDE_PROJECT_DIR:-.}" ls-files --error-unmatch "$rel" >/dev/null 2>&1; then
      echo "$rel — закоммиченная миграция, правки запрещены. Создай новую ревизию: cd packages/core && uv run alembic revision --autogenerate -m \"...\""
      return 0
    fi
  fi

  # 3. Секреты.
  if [[ "$rel" == ".env" || "$rel" == *"/.env" || "$rel" == ".env."* && "$rel" != ".env.example" ]]; then
    echo "$rel — файлы с секретами агент не редактирует. Меняй .env.example и попроси человека обновить .env"
    return 0
  fi

  return 1
}
