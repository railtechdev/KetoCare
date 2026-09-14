"""Цепочка выката прогоняется, а не разбирается по тексту.

Пароль администратора идёт из секретов GitHub через стандартный ввод скрипта,
переменную окружения, `eval`, файл окружения и `-e` у `docker compose` — пять
звеньев. До этого теста они держались регулярками по исходнику (#201), и шесть
форм обхода проходили молча: обнуление значения между стражем и запуском,
перенос строки к другой команде docker, подмена запускаемого скрипта, `elif`,
разбитый на `fi`+`if`, подмена значения в теле цикла рендера, отказ стирать
пароль с диска сервера.

Здесь скрипт запускается целиком на временном репозитории: `docker`, `flock` и
`curl` подменены заглушками в `PATH`, `deploy.sh` — пустышкой. Проверяется не
текст, а то, что дошло до подделки docker (#208).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "remote-deploy.sh"

#: Заглушка: пишет свои аргументы в файл и молчит. Так видно, что именно
#: получил `docker compose` — и получил ли вообще.
_DOCKER_STUB = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DOCKER_CALLS"
exit 0
"""

_TRUE_STUB = """#!/usr/bin/env bash
exit 0
"""


def _stub(directory: Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text(body)
    path.chmod(0o755)


@pytest.fixture
def deployment(tmp_path: Path) -> dict[str, Path]:
    """Временный «сервер»: репозиторий, подделки внешних команд, журнал вызовов."""

    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "--quiet", "--initial-branch=main"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "test"], cwd=repo, check=True)

    scripts = repo / "infra" / "scripts"
    scripts.mkdir(parents=True)
    # Настоящий deploy.sh собирает образы и раскладывает статику — на прогоне от
    # него нужно только то, что он не падает.
    _stub(scripts, "deploy.sh", _TRUE_STUB)
    (repo / "infra" / "docker-compose.prod.yml").write_text("services: {}\n")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "начало"], cwd=repo, check=True)
    # `git fetch origin` внутри скрипта: удалённый указывает сам на себя.
    subprocess.run(["git", "remote", "add", "origin", str(repo)], cwd=repo, check=True)
    subprocess.run(["git", "fetch", "--quiet", "origin"], cwd=repo, check=True)

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    _stub(fake_bin, "docker", _DOCKER_STUB)
    # flock есть не везде (на macOS его нет), curl ходил бы в сеть.
    _stub(fake_bin, "flock", _TRUE_STUB)
    _stub(fake_bin, "curl", _TRUE_STUB)

    return {"repo": repo, "bin": fake_bin, "calls": tmp_path / "docker-calls.txt"}


def _run(
    deployment: dict[str, Path], env_file: str, *, script: Path | None = None
) -> subprocess.CompletedProcess[str]:
    """Прогнать выкат, подав `env_file` на стандартный вход."""

    environment = {
        **os.environ,
        "PATH": f"{deployment['bin']}:{os.environ['PATH']}",
        "KETOCARE_REPO": str(deployment["repo"]),
        "KETOCARE_SELF": str(deployment["repo"] / "self.sh"),
        "DOCKER_CALLS": str(deployment["calls"]),
        "SSH_ORIGINAL_COMMAND": "main",
    }
    return subprocess.run(
        ["bash", str(script or _SCRIPT)],
        input=env_file,
        capture_output=True,
        text=True,
        env=environment,
        cwd=deployment["repo"],
    )


#: Файл окружения приходит на стандартный вход ровно в том виде, в каком его
#: печатает `deploy.yml`: каждое значение пропущено через `shlex.quote`. Это не
#: мелочь оформления — на `eval` завязана вся передача `ADMIN_*`, и
#: незакавыченное имя с пробелом роняет выкат целиком (`command not found`).
WITH_ADMIN = """POSTGRES_PASSWORD=p
ADMIN_EMAIL=admin@clinic.example
ADMIN_PASSWORD='пароль-из-секретов'
ADMIN_NAME='Админ Клиники'
"""

WITHOUT_PASSWORD = """POSTGRES_PASSWORD=p
ADMIN_EMAIL=admin@clinic.example
"""


class TestPasswordReachesTheContainer:
    """Главное: пароль доезжает до `create_admin.py`, а не просто упомянут."""

    def test_password_is_passed_to_the_container(self, deployment: dict[str, Path]) -> None:
        result = _run(deployment, WITH_ADMIN)

        assert result.returncode == 0, result.stderr
        calls = deployment["calls"].read_text()
        assert "create_admin.py" in calls, "администратор не заводился вовсе"
        assert "-e ADMIN_PASSWORD=пароль-из-секретов" in calls, (
            "пароль не дошёл до контейнера: значение потерялось в цепочке"
        )

    def test_password_never_lands_on_disk(self, deployment: dict[str, Path]) -> None:
        """Учётные данные не остаются в файле окружения сервера.

        `deploy.yml` обещает это словами («на диск сервера НЕ попадают»); до
        сих пор обещание ничем не проверялось.
        """
        _run(deployment, WITH_ADMIN)

        saved = (deployment["repo"] / ".env").read_text()
        assert "пароль-из-секретов" not in saved
        assert "ADMIN_" not in saved
        assert "POSTGRES_PASSWORD=p" in saved, "остальное окружение должно сохраниться"

    def test_name_with_space_survives_the_chain(self, deployment: dict[str, Path]) -> None:
        """Имя с пробелом доезжает целиком — на этом держится `shlex.quote`.

        Проверено обратным: незакавыченное значение с пробелом роняет `eval` и
        весь выкат («Клиники: command not found», код 127). Тест фиксирует, что
        квотирование на стороне `deploy.yml` обязательно.
        """
        result = _run(deployment, WITH_ADMIN)

        assert result.returncode == 0, result.stderr
        assert "--name Админ Клиники" in deployment["calls"].read_text()

    def test_email_without_password_creates_nothing(self, deployment: dict[str, Path]) -> None:
        """Страж: адрес без пароля — отказ, а не генерация с печатью в журнал.

        Сгенерированный пароль ушёл бы в журнал публичного прогона.
        """
        result = _run(deployment, WITHOUT_PASSWORD)

        assert result.returncode == 0, result.stderr
        assert "учётка не создана" in result.stderr
        calls = deployment["calls"].read_text() if deployment["calls"].exists() else ""
        assert "create_admin.py" not in calls


class TestChainCannotBeQuietlyBroken:
    """Формы обхода, которые разбор текста пропускал (#201)."""

    def _patched(self, deployment: dict[str, Path], old: str, new: str) -> Path:
        """Копия скрипта с подменённой строкой — так правится «сервер»."""

        broken = deployment["repo"] / "broken-deploy.sh"
        broken.write_text(_SCRIPT.read_text().replace(old, new, 1))
        return broken

    def test_passing_empty_value_is_caught(self, deployment: dict[str, Path]) -> None:
        """`-e ADMIN_PASSWORD=""` — страж пропускает, контейнер получает пустое.

        Именно этот случай разбор текста не ловил: переменная оболочки задана,
        ветка-предупреждение не срабатывает, а пароль генерируется внутри и
        печатается в журнал.
        """
        script = self._patched(
            deployment,
            '-e ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"',
            '-e ADMIN_PASSWORD=""',
        )

        _run(deployment, WITH_ADMIN, script=script)

        calls = deployment["calls"].read_text()
        assert "-e ADMIN_PASSWORD=пароль-из-секретов" not in calls, (
            "подмена значения пустым должна быть видна прогоном"
        )

    def test_dropping_eval_is_caught(self, deployment: dict[str, Path]) -> None:
        """Без `eval` переменные ADMIN_* не попадают в окружение процесса."""
        script = self._patched(deployment, 'eval "$ADMIN_LINES"', ":")

        result = _run(deployment, WITH_ADMIN, script=script)

        calls = deployment["calls"].read_text() if deployment["calls"].exists() else ""
        assert "create_admin.py" not in calls, (
            "без eval адрес администратора пуст — учётка не заводится"
        )
        assert result.returncode == 0

    def test_replacing_the_script_is_caught(self, deployment: dict[str, Path]) -> None:
        """Контейнеру подсунули другой скрипт — видно по аргументам."""
        script = self._patched(
            deployment,
            "api python infra/scripts/create_admin.py",
            "api python infra/scripts/seed_demo.py",
        )

        _run(deployment, WITH_ADMIN, script=script)

        calls = deployment["calls"].read_text()
        assert "create_admin.py" not in calls
        assert "seed_demo.py" in calls, "подмена скрипта обязана быть видна"

    def test_guard_split_into_two_ifs_is_caught(self, deployment: dict[str, Path]) -> None:
        """`elif` → `fi`+`if`: печатается предупреждение И создаётся учётка."""
        script = self._patched(
            deployment,
            'elif [ -n "${ADMIN_EMAIL:-}" ]; then',
            'fi\nif [ -n "${ADMIN_EMAIL:-}" ]; then',
        )

        result = _run(deployment, WITHOUT_PASSWORD, script=script)

        calls = deployment["calls"].read_text() if deployment["calls"].exists() else ""
        assert "учётка не создана" in result.stderr
        assert "create_admin.py" in calls, (
            "разбитый страж создаёт учётку вопреки предупреждению — прогон это видит"
        )

    def test_keeping_admin_lines_on_disk_is_caught(self, deployment: dict[str, Path]) -> None:
        """Без вычистки `ADMIN_*` пароль остаётся в файле окружения сервера."""
        script = self._patched(
            deployment,
            'grep -v \'^ADMIN_\' "$REPO/.env.next" > "$REPO/.env.clean"',
            'cp "$REPO/.env.next" "$REPO/.env.clean"',
        )

        _run(deployment, WITH_ADMIN, script=script)

        saved = (deployment["repo"] / ".env").read_text()
        assert "пароль-из-секретов" in saved, (
            "прогон обязан замечать, что учётные данные осели на диске"
        )


def test_stubs_are_used_not_real_docker(deployment: dict[str, Path]) -> None:
    """Страховка: тест не должен случайно позвать настоящий docker.

    Если подделка не встала в `PATH`, прогон ушёл бы к реальному демону — и
    «зелёный» тест означал бы совсем другое.
    """
    assert shutil.which("docker", path=str(deployment["bin"])) == str(deployment["bin"] / "docker")
