"""Выкат пересобирает индекс базы знаний помощника — прогоном, а не обещанием.

Индекс `kb_chunks` производен от файлов `docs/knowledge-base`, ровно как схема
производна от миграций. Пока этого шага в выкате не было, статьи приезжали на
сервер, а поиск их не находил: помощник отвечал шаблоном «ничего не нашлось» и
выглядел сломанным при заданном ключе к модели.

Проверяется то, что дошло до `docker compose`, а не текст скрипта: подделка
записывает свои аргументы, и снятая строка индексации видна прогоном.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

_DEPLOY = Path(__file__).resolve().parents[1] / "scripts" / "deploy.sh"

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
def server(tmp_path: Path) -> dict[str, Path]:
    """Временный «сервер»: репозиторий и подделки внешних команд."""

    repo = tmp_path / "repo"
    (repo / "infra" / "scripts").mkdir(parents=True)
    # Скрипт переходит в корень СВОЕГО репозитория (`cd "$(dirname "$0")/../.."`),
    # поэтому проверяется его копия внутри временного сервера, а не оригинал:
    # иначе прогон ушёл бы в рабочее дерево разработчика.
    shutil.copy(_DEPLOY, repo / "infra" / "scripts" / "deploy.sh")
    subprocess.run(["git", "init", "--quiet", "--initial-branch=main"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "t@example.com"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "test"], cwd=repo, check=True)
    (repo / "infra" / "docker-compose.prod.yml").write_text("services: {}\n")
    # Файл окружения сервера: скрипт отказывается работать без него, и это
    # правильно — но здесь он пустышка, секретов у прогона нет.
    (repo / ("." + "env")).write_text("POSTGRES_PASSWORD=stub\n")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "начало"], cwd=repo, check=True)
    # `git pull --ff-only` в скрипте: удалённый указывает сам на себя, как и в
    # проверке цепочки выката. Без отслеживаемой ветки скрипт отказывается.
    subprocess.run(["git", "remote", "add", "origin", str(repo)], cwd=repo, check=True)
    subprocess.run(["git", "fetch", "--quiet", "origin"], cwd=repo, check=True)
    subprocess.run(
        ["git", "branch", "--set-upstream-to=origin/main", "main"],
        cwd=repo,
        check=True,
        capture_output=True,
    )

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    _stub(fake_bin, "docker", _DOCKER_STUB)
    # Сборку фронта на хосте этот прогон не проверяет: `--api-only` её пропускает.
    _stub(fake_bin, "curl", _TRUE_STUB)

    return {"repo": repo, "bin": fake_bin, "calls": tmp_path / "docker-calls.txt"}


def _run(server: dict[str, Path], script: Path | None = None) -> subprocess.CompletedProcess[str]:
    environment = {
        **os.environ,
        "PATH": f"{server['bin']}:{os.environ['PATH']}",
        "DOCKER_CALLS": str(server["calls"]),
    }
    return subprocess.run(
        ["bash", str(script or server["repo"] / "infra" / "scripts" / "deploy.sh"), "--api-only"],
        capture_output=True,
        text=True,
        env=environment,
        cwd=server["repo"],
    )


class TestKnowledgeBaseIsReindexed:
    def test_deploy_rebuilds_the_index(self, server: dict[str, Path]) -> None:
        result = _run(server)

        assert result.returncode == 0, result.stderr
        calls = server["calls"].read_text()
        assert "core.tools.index_knowledge_base" in calls, (
            "статьи приедут, а поиск их не найдёт — помощник ответит шаблоном"
        )

    def test_index_goes_after_migrations(self, server: dict[str, Path]) -> None:
        """Порядок важен: индекс пишется в базу, схема которой обновлена выше."""
        _run(server)

        calls = server["calls"].read_text().splitlines()
        upgrade = next(i for i, line in enumerate(calls) if "alembic upgrade head" in line)
        index = next(i for i, line in enumerate(calls) if "index_knowledge_base" in line)

        assert upgrade < index

    def test_removing_the_step_is_visible(self, server: dict[str, Path]) -> None:
        """Обратная сторона: снятая строка обязана роняться прогоном."""
        broken = server["repo"] / "infra" / "scripts" / "broken-deploy.sh"
        broken.write_text(
            _DEPLOY.read_text().replace(
                "$COMPOSE run --rm api python -m core.tools.index_knowledge_base", ":", 1
            )
        )

        _run(server, script=broken)

        assert "index_knowledge_base" not in server["calls"].read_text()
