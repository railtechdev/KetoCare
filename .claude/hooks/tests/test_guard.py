"""Тесты защитных хуков.

Хуки — это код, который молча перестаёт работать: ошибка в них не роняет сборку,
а просто пропускает то, что должна была блокировать. Один такой дефект уже был —
`lstrip("./")` превращал ".env" в "env", и защита секретов не срабатывала.
Поэтому набор гоняется вместе с остальными тестами (`make test`).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
GUARD = REPO_ROOT / ".claude" / "hooks" / "guard_command.py"

ALLOW, BLOCK = 0, 2


def run_guard(mode: str, payload: dict) -> int:
    result = subprocess.run(
        [sys.executable, str(GUARD), mode],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env={**os.environ, "CLAUDE_PROJECT_DIR": str(REPO_ROOT)},
    )
    return result.returncode


def check_file(path: str) -> int:
    return run_guard("file", {"tool_input": {"file_path": path}})


def check_command(command: str) -> int:
    return run_guard("command", {"tool_input": {"command": command}})


class TestProtectedFiles:
    @pytest.mark.parametrize(
        "path",
        [
            "docs/medical/calculation-engine-spec.md",
            "docs/medical/reference-cases/solve_feasible_4to1_basic.yaml",
            ".env",
            ".env.local",
            "./.env",
            ".claude/hooks/guard_command.py",
            ".claude/settings.json",
        ],
    )
    def test_blocked(self, path: str) -> None:
        assert check_file(path) == BLOCK, f"{path} должен быть защищён"

    @pytest.mark.parametrize(
        "path",
        [
            "docs/medical/OPEN_QUESTIONS.md",  # агент обязан писать сюда вопросы
            ".env.example",  # объявление переменных — задача агента
            "apps/api/src/api/main.py",
            "packages/keto_engine/src/keto_engine/engine.py",
            "docs/adr/0002-frontend-stack-alignment.md",
        ],
    )
    def test_allowed(self, path: str) -> None:
        assert check_file(path) == ALLOW, f"{path} блокироваться не должен"

    def test_absolute_path_resolved(self) -> None:
        assert check_file(str(REPO_ROOT / ".env")) == BLOCK

    def test_committed_migration_blocked_but_new_one_allowed(self) -> None:
        committed = "packages/core/migrations/versions/89d9663051ae_initial_schema.py"
        assert check_file(committed) == BLOCK, "закоммиченная миграция не правится"

        # Ещё не добавленная в индекс ревизия — легитимный результат autogenerate
        fresh = "packages/core/migrations/versions/zzzz_not_committed_yet.py"
        assert check_file(fresh) == ALLOW


class TestProtectedCommands:
    @pytest.mark.parametrize(
        "command",
        [
            "sed -i '' 's/4.0/9.9/' docs/medical/reference-cases/a.yaml",
            "echo hack > docs/medical/calculation-engine-spec.md",
            "rm docs/medical/reference-cases/a.yaml",
            "tee docs/medical/x.md",
            "git checkout -- docs/medical/",
            "echo X >> .env",
            "cp /tmp/x.yaml docs/medical/reference-cases/",
            "sed -i '' 's/x/y/' packages/core/migrations/versions/89d9663051ae_initial_schema.py",
        ],
    )
    def test_direct_writes_blocked(self, command: str) -> None:
        assert check_command(command) == BLOCK

    @pytest.mark.parametrize(
        "command",
        [
            # Запись через интерпретатор: перечислить все способы нельзя, поэтому
            # проверка идёт «запрещено, пока не доказано чтение».
            "python3 -c \"open('docs/medical/spec.md','w').write('x')\"",
            "node -e \"require('fs').writeFileSync('docs/medical/spec.md','x')\"",
            "perl -pi -e 's/4/9/' docs/medical/reference-cases/a.yaml",
            "python3 - <<'EOF'\nopen('docs/medical/x','w')\nEOF",
            # cd уводит в защищённый каталог, дальше пишется относительный путь
            "cd docs/medical && rm spec.md",
            "cd docs/medical/reference-cases; rm a.yaml",
            # Попытка снять с себя защиту
            "rm .claude/hooks/guard_command.py",
            "echo '{}' > .claude/settings.json",
        ],
    )
    def test_indirect_writes_blocked(self, command: str) -> None:
        assert check_command(command) == BLOCK

    @pytest.mark.parametrize(
        "command",
        [
            "cat docs/medical/OPEN_QUESTIONS.md",
            "grep -rn ratio docs/medical/reference-cases/",
            "ls docs/medical/reference-cases | wc -l",
            "head -20 docs/medical/reference-cases/a.yaml",
            "find docs/medical -name '*.yaml'",
            'echo "новый вопрос" >> docs/medical/OPEN_QUESTIONS.md',
            "uv run pytest packages/keto_engine -q",
            "make lint",
            'cd packages/core && uv run alembic revision --autogenerate -m "add table"',
            "git status --short",
            "git log --oneline -5",
            "docker compose -f infra/docker-compose.dev.yml up -d",
        ],
    )
    def test_normal_work_allowed(self, command: str) -> None:
        assert check_command(command) == ALLOW, f"ложное срабатывание: {command}"


class TestConsistency:
    """Правила для Edit/Write и для Bash обязаны совпадать: раньше списки жили
    в двух местах (bash-функция и регулярки) и разошлись бы незаметно."""

    @pytest.mark.parametrize(
        "path",
        ["docs/medical/spec.md", ".env", ".claude/settings.json"],
    )
    def test_same_paths_blocked_in_both_modes(self, path: str) -> None:
        assert check_file(path) == BLOCK
        assert check_command(f"rm {path}") == BLOCK

    @pytest.mark.parametrize("path", ["docs/medical/OPEN_QUESTIONS.md", ".env.example"])
    def test_same_exceptions_allowed_in_both_modes(self, path: str) -> None:
        assert check_file(path) == ALLOW
        assert check_command(f"cat {path}") == ALLOW


class TestSettingsWiring:
    """Правильный хук, который не запускается, — это отсутствующий хук.

    У каталога проекта в имени бывает пробел (`Downloads/My Apps/KetoCare`).
    Команды в `.claude/settings.json` стояли без кавычек, оболочка разбивала путь
    и пыталась выполнить `/Users/…/Downloads/My`. Молча не работали все четыре
    хука: защита выглядела настроенной и не проверяла ничего — именно так
    `make fix` однажды переписал 34 эталонных случая в `docs/medical`.

    Проверка дешёвая, а дефект не виден ничем другим: хук не падает заметно, он
    просто не запускается.
    """

    SETTINGS = REPO_ROOT / ".claude" / "settings.json"

    def _commands(self) -> list[str]:
        settings = json.loads(self.SETTINGS.read_text(encoding="utf-8"))
        return [
            hook["command"]
            for phase in settings["hooks"].values()
            for matcher in phase
            for hook in matcher["hooks"]
            if hook.get("type") == "command"
        ]

    def test_hook_paths_are_quoted(self) -> None:
        for command in self._commands():
            assert command.startswith('"') and command.endswith('"'), (
                f"путь хука не в кавычках: {command} — "
                "каталог с пробелом в имени разобьётся, и хук не запустится"
            )

    def test_every_hook_script_exists_and_is_executable(self) -> None:
        for command in self._commands():
            path = Path(
                command.strip('"').replace("$CLAUDE_PROJECT_DIR", str(REPO_ROOT))
            )
            assert path.is_file(), f"хук не найден: {path}"
            assert os.access(path, os.X_OK), f"хук не исполняемый: {path}"

    def test_hooks_run_from_a_path_with_spaces(self, tmp_path: Path) -> None:
        """Тот самый случай: копия проекта в каталоге с пробелом в имени.

        Запуск идёт ровно так, как его выполняет раннер хуков, — строкой из
        settings.json через оболочку. Без кавычек тест падает.
        """
        project = tmp_path / "My Apps" / "KetoCare"
        (project / ".claude").mkdir(parents=True)
        shutil.copytree(REPO_ROOT / ".claude" / "hooks", project / ".claude" / "hooks")

        for command in self._commands():
            result = subprocess.run(
                ["sh", "-c", command],
                input=json.dumps({"tool_input": {"file_path": "README.md"}}),
                text=True,
                capture_output=True,
                env={**os.environ, "CLAUDE_PROJECT_DIR": str(project)},
            )
            assert "No such file or directory" not in result.stderr, (
                f"хук не запустился из каталога с пробелом: {command}\n{result.stderr}"
            )
            assert result.returncode == ALLOW, (
                f"хук вернул {result.returncode} на разрешённом файле: {command}"
            )
