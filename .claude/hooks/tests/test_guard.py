"""Тесты защитных хуков.

Хуки — это код, который молча перестаёт работать: ошибка в них не роняет сборку,
а просто пропускает то, что должна была блокировать. Один такой дефект уже был —
`lstrip("./")` превращал ".env" в "env", и защита секретов не срабатывала.
Поэтому набор гоняется вместе с остальными тестами (`make test`).

Второе назначение набора появилось, когда с кода хуков сняли механическую
защиту: `TestRulesAreIntact` — сигнальный тест. Пока он зелёный, ни один запрет
не исчез; если запрет убрали намеренно, тест придётся править в том же PR, и это
видно в ревью.
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


def run_guard(mode: str, payload: dict, cwd: Path | None = None) -> int:
    root = cwd or REPO_ROOT
    result = subprocess.run(
        [sys.executable, str(GUARD), mode],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env={**os.environ, "CLAUDE_PROJECT_DIR": str(root)},
    )
    return result.returncode


def check_file(path: str) -> int:
    return run_guard("file", {"tool_input": {"file_path": path}})


def check_command(command: str, cwd: Path | None = None, run_in: Path | None = None) -> int:
    """`cwd` — каталог проекта для хука, `run_in` — каталог, где идёт команда.

    Раньше это было одно и то же, и в этом состоял дефект: правило про main
    читало ветку всегда в каталоге проекта, даже когда команда выполнялась в
    другом репозитории.
    """

    payload: dict = {"tool_input": {"command": command}}
    if run_in is not None:
        payload["cwd"] = str(run_in)
    return run_guard("command", payload, cwd=cwd)


@pytest.fixture
def repo_on_main(tmp_path: Path) -> Path:
    """Пустой репозиторий с веткой main и одним коммитом.

    Нужен настоящий git: правило про main читает текущую ветку, и подделать её
    переменной окружения нельзя.
    """

    repo = tmp_path / "repo"
    repo.mkdir()
    run = lambda *args: subprocess.run(args, cwd=repo, check=True, capture_output=True)  # noqa: E731
    run("git", "init", "-b", "main")
    run("git", "config", "user.email", "t@example.com")
    run("git", "config", "user.name", "t")
    (repo / "README.md").write_text("x", encoding="utf-8")
    run("git", "add", "README.md")
    run("git", "commit", "-m", "init")
    return repo


class TestProtectedFiles:
    @pytest.mark.parametrize(
        "path",
        [
            "docs/medical/calculation-engine-spec.md",
            "docs/medical/reference-cases/solve_feasible_4to1_basic.yaml",
            ".env",
            ".env.local",
            "./.env",
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
            # Код хуков правится: изменение видно в PR, а этот набор — сигнальный.
            ".claude/hooks/guard_command.py",
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
            # `.env` как цель записи, а не как читаемый вход
            "sed -i '' 's/x/y/' .env",
            "cp .env /tmp/leak",
            "rm .env",
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
            # Выключение всех хуков разом
            "echo '{}' > .claude/settings.json",
            # Каталог миграций целиком — не отдельный незакоммиченный файл
            "rm -rf packages/core/migrations/versions",
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
            "cat .env.example",
        ],
    )
    def test_normal_work_allowed(self, command: str) -> None:
        assert check_command(command) == ALLOW, f"ложное срабатывание: {command}"


class TestEnvIsProtectedFromWritingNotFromReading:
    """`.env` защищается как ФАЙЛ, а не как слово в командной строке.

    Раньше блокировалось любое упоминание: `docker compose --env-file .env … config`
    не проходил, хотя ничего в файл не пишет. Работать это не мешало ровно до тех
    пор, пока не понадобилось поднять прод-конфигурацию — а там `--env-file`
    обязателен, и запрет начал мешать делу, ничего не защищая.
    """

    @pytest.mark.parametrize(
        "command",
        [
            "docker compose --env-file .env -f infra/docker-compose.prod.yml config",
            "docker compose --env-file .env -f infra/docker-compose.prod.yml ps",
            "docker compose --env-file .env -f infra/docker-compose.prod.yml up -d",
            "docker compose --env-file=.env -f infra/docker-compose.prod.yml logs api",
            "grep SECRET_KEY .env",
            "cat .env",
        ],
    )
    def test_reading_env_allowed(self, command: str) -> None:
        assert check_command(command) == ALLOW, f"чтение .env заблокировано: {command}"

    @pytest.mark.parametrize(
        "command",
        [
            "echo 'SECRET_KEY=x' > .env",
            "printf 'A=1\\n' >> .env",
            "python3 -c \"open('.env','w').write('X')\"",
            "mv /tmp/env .env",
        ],
    )
    def test_writing_env_blocked(self, command: str) -> None:
        assert check_command(command) == BLOCK, f"запись в .env пропущена: {command}"


class TestRemoteWorkIsNotLocalWork:
    """`ssh` пишет на ЧУЖОЙ машине.

    Защищается файл `.env` этого репозитория, а не строка «.env» в командной
    строке. Пока разбора не было, любая работа с сервером — записать окружение,
    посмотреть конфигурацию compose — упиралась в защиту локального файла,
    ничего при этом не защищая.
    """

    @pytest.mark.parametrize(
        "command",
        [
            "ssh ketocare@example.com 'umask 077 && cat > /srv/ketocare/.env'",
            'ssh root@example.com "docker compose --env-file .env -f x.yml ps"',
            "ssh ketocare@example.com 'rm /srv/app/docs/medical/x.md'",
        ],
    )
    def test_remote_paths_allowed(self, command: str) -> None:
        assert check_command(command) == ALLOW, f"удалённый путь принят за локальный: {command}"

    @pytest.mark.parametrize(
        "command",
        [
            # Перенаправление ВНЕ кавычек пишет уже на этой машине.
            "ssh host 'cat /etc/passwd' > .env",
            "ssh host 'cat x' >> docs/medical/spec.md",
            # scp и rsync принимают локальный путь целью — послабление не для них.
            "scp host:/tmp/x .env",
            "rsync host:/tmp/spec.md docs/medical/spec.md",
        ],
    )
    def test_local_side_still_protected(self, command: str) -> None:
        assert check_command(command) == BLOCK, f"локальная запись пропущена: {command}"


class TestFreshMigrationIsNotProtected:
    """Правило ТЗ — «закоммиченная миграция не правится».

    Хук трактовал его как «каталог миграций неприкосновенен», и после
    `alembic revision --autogenerate` нельзя было ни удалить черновик, ни
    выполнить `git add` для настоящей ревизии: приходилось звать человека
    ради двух команд, к правилу отношения не имевших.
    """

    FRESH = "packages/core/migrations/versions/zzzz9999_not_committed_yet.py"
    COMMITTED = "packages/core/migrations/versions/89d9663051ae_initial_schema.py"

    @pytest.mark.parametrize("template", ["rm {}", "git add {}", "mv {} /tmp/x.py"])
    def test_fresh_migration_can_be_handled(self, template: str) -> None:
        assert check_command(template.format(self.FRESH)) == ALLOW

    @pytest.mark.parametrize("template", ["rm {}", "sed -i '' 's/a/b/' {}"])
    def test_committed_migration_still_protected(self, template: str) -> None:
        assert check_command(template.format(self.COMMITTED)) == BLOCK

    def test_relative_path_after_cd_does_not_slip_through(self) -> None:
        """Сверка по полному пути открывала дыру.

        `cd packages/core && rm <каталог>/<закоммиченная>.py` даёт путь, которого
        нет в индексе, если считать от корня репозитория, — и проверка сочла бы
        закоммиченную ревизию новой. Поэтому сверка идёт по имени файла: имя
        ревизии несёт хеш и уникально.
        """

        name = self.COMMITTED.rsplit("/", 1)[-1]
        tail = self.COMMITTED.split("core/", 1)[1]
        assert check_command(f"cd packages/core && rm {tail}") == BLOCK
        assert check_command(f"rm {tail}") == BLOCK
        assert name in tail


class TestMainGoesThroughPullRequest:
    """Ветка → PR → merge.

    Коммит прямо в main минует ревью и зелёный CI, а с автодеплоем сразу уезжает
    на боевой стенд: ошибка становится видна пользователям раньше, чем автору.
    """

    @pytest.mark.parametrize(
        "command",
        [
            'git commit -m "прямо в main"',
            "git commit --amend --no-edit",
            "git merge feat/x",
            "git rebase origin/main",
            "git cherry-pick abc123",
            "git push",
            "git push origin main",
            "git push -u origin main",
            "git push --force origin HEAD:main",
        ],
    )
    def test_blocked_on_main(self, command: str, repo_on_main: Path) -> None:
        assert check_command(command, cwd=repo_on_main) == BLOCK, f"пропущено на main: {command}"

    def test_switch_to_main_then_commit_is_blocked(self, repo_on_main: Path) -> None:
        # Хук проверяет ветку ДО выполнения, поэтому переход внутри той же
        # команды надо ловить отдельно — иначе правило обходится случайно.
        assert check_command('git switch main && git commit -m "x"', cwd=repo_on_main) == BLOCK

    @pytest.mark.parametrize(
        "command",
        [
            "git switch -c feat/x",
            "git status --short",
            "git log --oneline -5",
            "git fetch origin",
            "git pull --ff-only",
            "git push origin feat/x",
        ],
    )
    def test_normal_git_work_allowed_on_main(self, command: str, repo_on_main: Path) -> None:
        assert check_command(command, cwd=repo_on_main) == ALLOW, f"ложное срабатывание: {command}"

    def test_commit_allowed_on_feature_branch(self, repo_on_main: Path) -> None:
        subprocess.run(
            ["git", "switch", "-c", "feat/x"], cwd=repo_on_main, check=True, capture_output=True
        )
        assert check_command('git commit -m "работа в ветке"', cwd=repo_on_main) == ALLOW
        assert check_command("git push -u origin feat/x", cwd=repo_on_main) == ALLOW


class TestRulesAreIntact:
    """Сигнальный тест: ни один запрет не исчез.

    Код хуков больше не защищён механически — вместо этого каждое его изменение
    проходит через PR. Этот тест переводит «правила на месте» из обещания в
    проверяемое утверждение: чтобы снять запрет, придётся снять и его здесь,
    и это будет видно в диффе.
    """

    def test_every_documented_protection_still_blocks(self) -> None:
        must_block = {
            "медицинские спецификации": "docs/medical/calculation-engine-spec.md",
            "эталонные случаи": "docs/medical/reference-cases/a.yaml",
            "файл секретов": ".env",
            "настройки хуков": ".claude/settings.json",
            "закоммиченная миграция": (
                "packages/core/migrations/versions/89d9663051ae_initial_schema.py"
            ),
            "клинические статьи помощника": ("docs/knowledge-base/clinical/ketones-target.md"),
        }
        for what, path in must_block.items():
            assert check_file(path) == BLOCK, f"защита снята: {what} ({path})"

    def test_documented_exceptions_still_pass(self) -> None:
        for path in (
            "docs/medical/OPEN_QUESTIONS.md",
            ".env.example",
            # Статьи про кнопки пишет агент: за них отвечает продукт, а не
            # медицинская команда. Защищена только клиническая половина базы.
            "docs/knowledge-base/product/how-to-record-ketones.md",
            "docs/knowledge-base/README.md",
        ):
            assert check_file(path) == ALLOW, f"исключение перестало работать: {path}"


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
            path = Path(command.strip('"').replace("$CLAUDE_PROJECT_DIR", str(REPO_ROOT)))
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


class TestHeredocBodyIsData:
    """Тело `<<EOF … EOF` — данные команды, а не команды.

    Раньше оно резалось по переводам строк наравне с кодом, и каждая строка
    выглядела отдельной локальной командой. Два ложных срабатывания подряд:
    сообщение коммита, где упомянута работа с main, упиралось в правило про
    main; скрипт для сервера, отправленный по ssh, — в защиту локальных
    секретов. Оба раза защита мешала работе, ничего не защищая.
    """

    @pytest.mark.parametrize(
        "command",
        [
            # Содержимое файла, а не команда над защищённым путём.
            "cat > /tmp/note.md <<'EOF'\nсм. docs/medical/calculation-engine-spec.md\nEOF",
            # Скрипт для удалённой машины целиком.
            "ssh ketocare@example.com <<'EOF'\ncat > /srv/ketocare/.env\nEOF",
        ],
    )
    def test_data_in_body_allowed(self, command: str) -> None:
        assert check_command(command) == ALLOW, f"тело heredoc принято за команды: {command}"

    def test_commit_message_mentioning_a_protected_path_allowed(self, repo_on_main: Path) -> None:
        """Текст сообщения коммита — данные: в нём встречаются и пути, и команды.

        Проверяется в СВОЁМ репозитории на своей ветке. В настоящем проекте
        результат зависел бы от того, какая ветка выбрана сейчас: на main
        `git commit` блокируется по другому правилу, и тест то проходил бы, то
        падал. На CI он и упал, хотя локально был зелёным.
        """

        subprocess.run(
            ["git", "switch", "-c", "feat/x"], cwd=repo_on_main, check=True, capture_output=True
        )
        command = "git commit -F - <<'EOF'\nправка docs/medical/OPEN_QUESTIONS.md\nEOF"
        assert check_command(command, cwd=repo_on_main) == ALLOW

    @pytest.mark.parametrize(
        "command",
        [
            # Оболочка ИСПОЛНЯЕТ тело: каждая строка обязана проверяться.
            "bash <<'EOF'\nrm .env\nEOF",
            "sh <<'EOF'\nrm docs/medical/calculation-engine-spec.md\nEOF",
            "python3 - <<'EOF'\nopen('docs/medical/x','w')\nEOF",
            # Цель записи стоит в самой команде, а не в теле.
            "cat > docs/medical/spec.md <<'EOF'\nтекст\nEOF",
        ],
    )
    def test_code_in_body_still_blocked(self, command: str) -> None:
        assert check_command(command) == BLOCK, f"исполняемое тело пропущено: {command}"

    def test_commit_message_mentioning_main_is_not_a_main_operation(
        self, repo_on_main: Path
    ) -> None:
        subprocess.run(
            ["git", "switch", "-c", "feat/x"], cwd=repo_on_main, check=True, capture_output=True
        )
        command = "git commit -F - <<'EOF'\nfix: описано, почему git push origin main запрещён\nEOF"
        assert check_command(command, cwd=repo_on_main) == ALLOW


class TestMainRuleAppliesToThisProjectOnly:
    """Правило защищает main ЭТОГО репозитория.

    Ветка читалась всегда в каталоге проекта, а команда могла выполняться в
    другом: одноразовый репозиторий под scratchpad, куда агент складывает
    проверки, блокировался за то, что в KetoCare сейчас выбрана main. Правило
    мешало работе и не защищало ничего: чужой main нам не деплой и не ревью.
    """

    @pytest.fixture
    def foreign_repo(self, tmp_path: Path) -> Path:
        repo = tmp_path / "foreign"
        repo.mkdir()
        run = lambda *a: subprocess.run(a, cwd=repo, check=True, capture_output=True)  # noqa: E731
        run("git", "init", "-b", "main")
        run("git", "config", "user.email", "t@example.com")
        run("git", "config", "user.name", "t")
        (repo / "x.txt").write_text("x", encoding="utf-8")
        run("git", "add", "x.txt")
        run("git", "commit", "-m", "init")
        return repo

    def test_commit_in_foreign_repo_allowed(self, repo_on_main: Path, foreign_repo: Path) -> None:
        assert (
            check_command(
                f'cd {foreign_repo} && git commit -m "проверка"',
                cwd=repo_on_main,
            )
            == ALLOW
        )

    def test_commit_from_foreign_cwd_allowed(self, repo_on_main: Path, foreign_repo: Path) -> None:
        assert (
            check_command('git commit -m "проверка"', cwd=repo_on_main, run_in=foreign_repo)
            == ALLOW
        )

    def test_commit_in_project_still_blocked(self, repo_on_main: Path) -> None:
        # Тот же вызов, но каталог — сам проект: правило работает как прежде.
        assert (
            check_command('git commit -m "прямо в main"', cwd=repo_on_main, run_in=repo_on_main)
            == BLOCK
        )


class TestLeavingMainInTheSameCommand:
    """Уход С главной ветки распознаётся так же, как переход НА неё.

    Распознавался только переход на main, и обычная связка `git switch feat/x
    && git rebase origin/main` блокировалась: правило считало, что мы всё ещё
    на main. Ветка теперь отслеживается по ходу команды.
    """

    @pytest.fixture
    def repo_with_branch(self, repo_on_main: Path) -> Path:
        subprocess.run(
            ["git", "branch", "feat/x"], cwd=repo_on_main, check=True, capture_output=True
        )
        return repo_on_main

    @pytest.mark.parametrize(
        "command",
        [
            'git switch feat/x && git commit -m "работа в ветке"',
            "git checkout feat/x && git rebase origin/main",
            'git switch -c feat/new && git commit -m "новая ветка"',
        ],
    )
    def test_work_after_leaving_main_allowed(self, command: str, repo_with_branch: Path) -> None:
        assert check_command(command, cwd=repo_with_branch) == ALLOW, (
            f"ложное срабатывание после ухода с main: {command}"
        )

    @pytest.mark.parametrize(
        "command",
        [
            'git switch feat/x && git switch main && git commit -m "назад в main"',
            'git switch main && git commit -m "в main"',
        ],
    )
    def test_returning_to_main_still_blocked(self, command: str, repo_with_branch: Path) -> None:
        assert check_command(command, cwd=repo_with_branch) == BLOCK, (
            f"возврат на main пропущен: {command}"
        )

    def test_restoring_a_file_is_not_a_switch(self, repo_with_branch: Path) -> None:
        """`git checkout README.md` восстанавливает файл, а не меняет ветку.

        Считать это уходом с main значило бы открыть дыру: следующий коммит
        ушёл бы в main без единого предупреждения.
        """

        assert (
            check_command('git checkout README.md && git commit -m "в main"', cwd=repo_with_branch)
            == BLOCK
        )
