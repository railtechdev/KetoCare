"""Два окружения выката — тестовый и боевой сервер (ADR-0095).

Три предохранителя, и каждый закрывает ошибку, которая на одном сервере была
невозможна:

1. **Сервер не принимает чужое окружение.** Перепутанный адрес в настройках
   выката положил бы секреты тестового на сервер с пациентами.
2. **Режим ожидания не запускает бота и воркер.** Бот с тем же токеном отобрал
   бы сообщения семей у работающего сервера, воркер разослал бы напоминания
   второй раз.
3. **На боевой едет только коммит из main, который сейчас стоит на тестовом.**

Скрипты запускаются целиком с подделками внешних команд: проверяется то, что
они сделали, а не то, что в них написано.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

_ROOT = Path(__file__).resolve().parents[2]
_REMOTE_DEPLOY = _ROOT / "infra" / "scripts" / "remote-deploy.sh"
_DEPLOY = _ROOT / "infra" / "scripts" / "deploy.sh"
_SERVER_SECRETS = _ROOT / "infra" / "scripts" / "server-secrets.sh"
_WORKFLOW = _ROOT / ".github" / "workflows" / "deploy.yml"

_RECORDING_STUB = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
exit 0
"""
_TRUE_STUB = "#!/usr/bin/env bash\nexit 0\n"


def _stub(directory: Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text(body)
    path.chmod(0o755)


def _git_repo(repo: Path) -> None:
    repo.mkdir()
    for command in (
        ["git", "init", "--quiet", "--initial-branch=main"],
        ["git", "config", "user.email", "t@example.com"],
        ["git", "config", "user.name", "test"],
    ):
        subprocess.run(command, cwd=repo, check=True)


def _commit(repo: Path) -> None:
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "начало"], cwd=repo, check=True)


# --- 1. сервер не принимает чужое окружение ---------------------------------------


#: Рабочее окружение «сервера» до выката.
WORKING = "POSTGRES_PASSWORD=working\n"
#: Что приносит выкат: несекретные настройки. Ключи у сервера свои.
SETTINGS = "WEB_ORIGIN=https://x\n"


@pytest.fixture
def server(tmp_path: Path) -> dict[str, Path]:
    repo = tmp_path / "repo"
    _git_repo(repo)
    scripts = repo / "infra" / "scripts"
    scripts.mkdir(parents=True)
    _stub(scripts, "deploy.sh", '#!/usr/bin/env bash\necho deployed >> "$CALLS"\n')
    (scripts / "server-secrets.sh").write_text(_SERVER_SECRETS.read_text(encoding="utf-8"))
    (repo / "infra" / "docker-compose.prod.yml").write_text("services: {}\n")
    # Рабочее окружение сервера: чужой выкат не вправе его тронуть.
    (repo / ".gitignore").write_text(".env*\n.deploy.lock\n")
    _commit(repo)
    subprocess.run(["git", "remote", "add", "origin", str(repo)], cwd=repo, check=True)
    subprocess.run(["git", "fetch", "--quiet", "origin"], cwd=repo, check=True)
    (repo / ".env").write_text(WORKING)
    # Ключи сервера: создал сам сервер, из GitHub они не приходят.
    secrets = tmp_path / "secrets"
    secrets.write_text("POSTGRES_PASSWORD='own'\nSECRET_KEY='own'\nBOT_API_TOKEN='own'\n")

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    for name in ("docker", "flock", "curl"):
        _stub(fake_bin, name, _TRUE_STUB)
    return {
        "repo": repo,
        "bin": fake_bin,
        "calls": tmp_path / "calls.txt",
        "mark": tmp_path / "mark",
        "secrets": secrets,
    }


def _remote_deploy(server: dict[str, Path], env_file: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(_REMOTE_DEPLOY)],
        input=env_file,
        capture_output=True,
        text=True,
        cwd=server["repo"],
        env={
            **os.environ,
            "PATH": f"{server['bin']}:{os.environ['PATH']}",
            "KETOCARE_REPO": str(server["repo"]),
            "KETOCARE_SELF": str(server["repo"] / "self.sh"),
            "KETOCARE_ENV_MARK": str(server["mark"]),
            "KETOCARE_SECRETS": str(server["secrets"]),
            "CALLS": str(server["calls"]),
            "SSH_ORIGINAL_COMMAND": "main",
        },
    )


class TestServerRefusesAnotherEnvironment:
    def test_demo_settings_do_not_land_on_production(self, server: dict[str, Path]) -> None:
        server["mark"].write_text("production\n")

        result = _remote_deploy(server, SETTINGS + "DEPLOY_ENVIRONMENT=demo\n")

        assert result.returncode == 66, result.stderr
        assert "отказано" in result.stderr
        # Рабочее окружение цело, выкат не начинался.
        assert (server["repo"] / ".env").read_text() == WORKING
        assert not (server["repo"] / ".env.next").exists()
        assert not server["calls"].exists()

    def test_own_environment_is_deployed(self, server: dict[str, Path]) -> None:
        server["mark"].write_text("production\n")

        result = _remote_deploy(server, SETTINGS + "DEPLOY_ENVIRONMENT=production\n")

        assert result.returncode == 0, result.stderr
        assert "WEB_ORIGIN=https://x" in (server["repo"] / ".env").read_text()
        assert server["calls"].read_text() == "deployed\n"

    def test_unmarked_server_refuses_a_named_environment(self, server: dict[str, Path]) -> None:
        """Сервер без метки заведён до двух окружений — новый выкат не для него."""

        result = _remote_deploy(server, SETTINGS + "DEPLOY_ENVIRONMENT=demo\n")

        assert result.returncode == 66
        assert not server["calls"].exists()

    def test_marked_server_refuses_an_unnamed_environment(self, server: dict[str, Path]) -> None:
        server["mark"].write_text("demo\n")

        result = _remote_deploy(server, SETTINGS)

        assert result.returncode == 66
        assert not server["calls"].exists()


class TestServerKeepsItsOwnKeys:
    """Ключи создаёт сервер; выкат приносит только несекретные настройки."""

    def test_keys_join_the_settings(self, server: dict[str, Path]) -> None:
        result = _remote_deploy(server, SETTINGS)

        assert result.returncode == 0, result.stderr
        environment = (server["repo"] / ".env").read_text()
        assert "WEB_ORIGIN=https://x" in environment
        assert "POSTGRES_PASSWORD='own'" in environment
        # Принесённые настройки лежат отдельно: по ним перенос пересобирает
        # окружение, когда меняет ключи.
        assert (server["repo"] / ".env.config").read_text() == SETTINGS

    def test_a_key_cannot_be_replaced_from_outside(self, server: dict[str, Path]) -> None:
        result = _remote_deploy(server, "SECRET_KEY=injected\n" + SETTINGS)

        assert result.returncode == 0, result.stderr
        environment = (server["repo"] / ".env").read_text()
        assert "injected" not in environment
        assert "SECRET_KEY='own'" in environment

    def test_settings_alone_never_replace_a_working_environment(
        self, server: dict[str, Path]
    ) -> None:
        """Сервер без своих ключей (заведён раньше) получил бы окружение без
        пароля базы — и потерял бы рабочее."""

        server["secrets"].unlink()

        result = _remote_deploy(server, SETTINGS)

        assert result.returncode == 65, result.stderr
        assert (server["repo"] / ".env").read_text() == WORKING
        assert not server["calls"].exists()


def _secrets(tmp_path: Path, *args: str, stdin: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(_SERVER_SECRETS), *args],
        input=stdin,
        capture_output=True,
        text=True,
        env={**os.environ, "KETOCARE_SECRETS": str(tmp_path / "secrets.env")},
    )


def _line(tmp_path: Path, name: str) -> str | None:
    for line in (tmp_path / "secrets.env").read_text().splitlines():
        if line.startswith(f"{name}="):
            return line
    return None


class TestServerSecrets:
    def test_init_creates_keys_once(self, tmp_path: Path) -> None:
        assert _secrets(tmp_path, "init").returncode == 0
        first = (tmp_path / "secrets.env").read_text()
        # Повторная настройка сервера не вправе сменить пароль базы.
        assert _secrets(tmp_path, "init").returncode == 0
        assert (tmp_path / "secrets.env").read_text() == first

        # Токена Telegram-бота и ключей ИИ здесь нет: их вводят в кабинете.
        assert _secrets(tmp_path, "names").stdout.split() == [
            "POSTGRES_PASSWORD",
            "SECRET_KEY",
            "BOT_API_TOKEN",
            "SETTINGS_ENCRYPTION_KEY",
            "MONITOR_TOKEN",
        ]
        assert (tmp_path / "secrets.env").stat().st_mode & 0o007 == 0

    def test_init_prints_names_not_values(self, tmp_path: Path) -> None:
        result = _secrets(tmp_path, "init")

        for line in (tmp_path / "secrets.env").read_text().splitlines():
            value = line.split("=", 1)[1].strip("'")
            assert value not in result.stdout + result.stderr

    def test_mirror_takes_the_named_and_drops_the_missing(self, tmp_path: Path) -> None:
        """Перенос: прежний сервер не имел отдельного ключа шифрования настроек —
        оставь новый свой, ключи ИИ из кабинета перестали бы читаться."""

        _secrets(tmp_path, "init")
        own_password = _line(tmp_path, "POSTGRES_PASSWORD")

        result = _secrets(
            tmp_path,
            "mirror",
            "SECRET_KEY",
            "SETTINGS_ENCRYPTION_KEY",
            "BOT_TOKEN",
            stdin="SECRET_KEY='from-old'\nBOT_TOKEN=1:abc\nPOSTGRES_PASSWORD=sneaked\n",
        )

        assert result.returncode == 0, result.stderr
        assert _line(tmp_path, "SECRET_KEY") == "SECRET_KEY='from-old'"
        assert _line(tmp_path, "BOT_TOKEN") == "BOT_TOKEN=1:abc"
        assert _line(tmp_path, "SETTINGS_ENCRYPTION_KEY") is None
        # Не названное в команде со входа не берётся.
        assert _line(tmp_path, "POSTGRES_PASSWORD") == own_password
        assert "from-old" not in result.stdout + result.stderr


def test_workflow_carries_no_application_secret() -> None:
    """В выкате нет ни одного секрета приложения — только доступ к серверу."""

    used = set(re.findall(r"secrets\.([A-Z_]+)", _WORKFLOW.read_text(encoding="utf-8")))
    assert used == {"DEPLOY_SSH_KEY", "DEPLOY_KNOWN_HOSTS", "DEPLOY_HOST", "DEPLOY_USER"}


def test_workflow_always_names_the_environment() -> None:
    """Имя окружения — обязательная строка окружения, и берётся оно у прогона."""

    workflow = yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))
    job = workflow["jobs"]["deploy"]
    assert job["environment"] == job["env"]["DEPLOY_ENVIRONMENT"]
    # Автоматический выкат (после CI) — только на тестовый.
    assert job["environment"].endswith("|| 'demo' }}")
    assemble = next(s for s in job["steps"] if s.get("name") == "Собрать настройки окружения")
    assert '"DEPLOY_ENVIRONMENT"' in assemble["run"]
    assert "for required in DEPLOY_ENVIRONMENT" in assemble["run"]


# --- 2. режим ожидания ------------------------------------------------------------


def _deploy(tmp_path: Path, *, standby: bool, bot_token: str = "1:token") -> list[str]:
    repo = tmp_path / "repo"
    _git_repo(repo)
    scripts = repo / "infra" / "scripts"
    scripts.mkdir(parents=True)
    (scripts / "deploy.sh").write_text(_DEPLOY.read_text(encoding="utf-8"))
    (scripts / "deploy.sh").chmod(0o755)
    (repo / "infra" / "docker-compose.prod.yml").write_text("services: {}\n")
    (repo / ".gitignore").write_text(".env\n")
    _commit(repo)
    # Отсоединённый HEAD, как после remote-deploy.sh: иначе скрипт делает pull.
    subprocess.run(["git", "checkout", "--quiet", "--detach"], cwd=repo, check=True)
    (repo / ".env").write_text(
        "POSTGRES_PASSWORD=p\n" + (f"BOT_TOKEN={bot_token}\n" if bot_token else "")
    )

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    _stub(fake_bin, "docker", _RECORDING_STUB)
    calls = tmp_path / "calls.txt"
    mark = tmp_path / "standby"
    if standby:
        mark.write_text("")

    result = subprocess.run(
        ["bash", str(scripts / "deploy.sh"), "--api-only"],
        capture_output=True,
        text=True,
        cwd=repo,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "CALLS": str(calls),
            "KETOCARE_STANDBY_MARK": str(mark),
        },
    )
    assert result.returncode == 0, result.stdout + result.stderr
    prefix = "compose --env-file .env -f infra/docker-compose.prod.yml "
    return [line.removeprefix(prefix) for line in calls.read_text().splitlines()]


class TestStandby:
    def test_bot_and_worker_do_not_start(self, tmp_path: Path) -> None:
        calls = _deploy(tmp_path, standby=True)

        assert "up -d postgres redis api" in calls
        assert "stop bot worker" in calls
        # Голый `up -d` поднял бы всё, включая бота с боевым токеном.
        assert "up -d" not in calls

    def test_working_server_starts_everything(self, tmp_path: Path) -> None:
        calls = _deploy(tmp_path, standby=False)

        assert "up -d" in calls
        assert "stop bot worker" not in calls

    def test_server_without_a_bot_token_starts_everything_but_the_bot(self, tmp_path: Path) -> None:
        """Без токена бот падает на старте и перезапускается по кругу."""

        calls = _deploy(tmp_path, standby=False, bot_token="")

        assert "up -d postgres redis api worker" in calls
        assert "stop bot" in calls
        assert "up -d" not in calls


# --- 3. боевой: только проверенный коммит из main ---------------------------------

SHA = "a" * 40
OTHER = "b" * 40


def _gate(
    tmp_path: Path,
    *,
    compare: str,
    on_demo: str,
    allow_untested: str = "false",
    demo_url: str = "https://app.demo.example",
) -> subprocess.CompletedProcess[str]:
    workflow = yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))
    step = next(s for s in workflow["jobs"]["deploy"]["steps"] if s.get("id") == "gate")
    # Шаг идёт только на боевом — иначе он мешал бы выкату на тестовый.
    assert "env.DEPLOY_ENVIRONMENT == 'production'" in step["if"]

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    _stub(fake_bin, "gh", f'#!/usr/bin/env bash\necho "{compare}"\n')
    _stub(
        fake_bin, "curl", f'#!/usr/bin/env bash\nprintf "%s\\n" "{on_demo}"\n[ -n "{on_demo}" ]\n'
    )
    script = tmp_path / "gate.sh"
    script.write_text("sleep() { :; }\n" + str(step["run"]))
    return subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "REF": SHA,
            "REPOSITORY": "owner/repo",
            "DEMO_APP_URL": demo_url,
            "ALLOW_UNTESTED": allow_untested,
        },
    )


class TestProductionGate:
    def test_commit_from_main_that_is_on_demo_passes(self, tmp_path: Path) -> None:
        result = _gate(tmp_path, compare="ahead", on_demo=SHA)
        assert result.returncode == 0, result.stdout + result.stderr

    def test_tip_of_main_passes(self, tmp_path: Path) -> None:
        assert _gate(tmp_path, compare="identical", on_demo=SHA).returncode == 0

    @pytest.mark.parametrize("compare", ["behind", "diverged"])
    def test_commit_outside_main_never_passes(self, tmp_path: Path, compare: str) -> None:
        """Ветка мимо PR на сервер с пациентами не едет — и флажок не помогает."""

        result = _gate(tmp_path, compare=compare, on_demo=SHA, allow_untested="true")

        assert result.returncode != 0
        assert "не входит в main" in result.stdout + result.stderr

    def test_commit_that_demo_does_not_run_is_refused(self, tmp_path: Path) -> None:
        result = _gate(tmp_path, compare="ahead", on_demo=OTHER)

        assert result.returncode != 0
        assert "Сначала выкат на тестовый" in result.stdout + result.stderr

    def test_silent_demo_is_a_refusal(self, tmp_path: Path) -> None:
        assert _gate(tmp_path, compare="ahead", on_demo="").returncode != 0

    def test_missing_demo_address_is_a_refusal(self, tmp_path: Path) -> None:
        assert _gate(tmp_path, compare="ahead", on_demo=SHA, demo_url="").returncode != 0

    def test_emergency_flag_skips_only_the_demo_check(self, tmp_path: Path) -> None:
        result = _gate(tmp_path, compare="ahead", on_demo=OTHER, allow_untested="true")

        assert result.returncode == 0
        assert "allow_untested" in result.stdout


# --- 4. выкат закрыт, пока окружение не настроено до конца ------------------------


def _ready(tmp_path: Path, *, ready: str, environment: str) -> subprocess.CompletedProcess[str]:
    workflow = yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))
    steps = workflow["jobs"]["deploy"]["steps"]
    step = next(s for s in steps if s.get("id") == "ready")
    # До сборки окружения из секретов: иначе чужие значения уже собраны в файл.
    names = [s.get("name") for s in steps]
    assert names.index("Окружение настроено") < names.index("Собрать настройки окружения")
    assert step["env"]["READY"] == "${{ vars.ENVIRONMENT_READY }}"
    script = tmp_path / "ready.sh"
    script.write_text(str(step["run"]))
    return subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)],
        capture_output=True,
        text=True,
        env={**os.environ, "READY": ready, "DEPLOY_ENVIRONMENT": environment},
    )


class TestHalfConfiguredEnvironment:
    """Секрет, которого у окружения нет, GitHub берёт с уровня репозитория."""

    def test_configured_environment_deploys(self, tmp_path: Path) -> None:
        assert _ready(tmp_path, ready="demo", environment="demo").returncode == 0

    @pytest.mark.parametrize("ready", ["", "configuring", "production"])
    def test_anything_else_stops_the_deploy(self, tmp_path: Path, ready: str) -> None:
        result = _ready(tmp_path, ready=ready, environment="demo")

        assert result.returncode != 0
        assert "не настроено" in result.stdout + result.stderr
