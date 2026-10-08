"""Выкат передаёт серверу полный SHA коммита — и при ручном запуске тоже.

08.10.2026 ручной запуск `gh workflow run deploy.yml --ref main` упал (прогон
37730148871): шаг передавал на сервер строку `main`, исполняемая копия
`remote-deploy.sh` разрешала её в ЛОКАЛЬНУЮ ветку, застывшую на fe63b65, и
выкатывала полугодовой код со старым `deploy.sh`, который падал на `git pull` в
отсоединённом HEAD. Уведомление о сбое выката при этом советует именно «Run
workflow» — то есть документированный путь восстановления был сломан.

Тело шага берётся из workflow и выполняется с подделкой `gh`: копия логики в
тесте проверяла бы саму себя.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
import yaml

_WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "deploy.yml"

TIP = "a" * 40
BRANCH_SHA = "b" * 40
OLD_SHA = "c" * 40

#: Подделка gh: `gh api repos/<repo>/commits/<ref> --jq .sha`.
_GH_STUB = f"""#!/usr/bin/env bash
echo "$*" >> "$GH_CALLS"
case "$2" in
  repos/owner/repo/commits/main) echo {TIP} ;;
  repos/owner/repo/commits/feat/x) echo {BRANCH_SHA} ;;
  repos/owner/repo/commits/{OLD_SHA}) echo {OLD_SHA} ;;
  *) echo "Not Found" >&2; exit 1 ;;
esac
"""


def _target_step() -> dict[str, object]:
    workflow = yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))
    for step in workflow["jobs"]["deploy"]["steps"]:
        if step.get("id") == "target":
            return dict(step)
    raise AssertionError("шаг «Определить и проверить коммит» исчез из выката")


def _run(
    tmp_path: Path, *, event: str, input_ref: str = "", run_sha: str = ""
) -> tuple[subprocess.CompletedProcess[str], dict[str, str]]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir(exist_ok=True)
    gh = fake_bin / "gh"
    gh.write_text(_GH_STUB)
    gh.chmod(0o755)
    output = tmp_path / "output"
    output.write_text("")

    script = tmp_path / "target.sh"
    script.write_text(str(_target_step()["run"]))
    result = subprocess.run(
        # Так шаг запускает сам GitHub: `bash --noprofile --norc -eo pipefail`.
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
            "GITHUB_OUTPUT": str(output),
            "GH_CALLS": str(tmp_path / "gh-calls"),
            "EVENT": event,
            "INPUT_REF": input_ref,
            "RUN_SHA": run_sha,
            "REPOSITORY": "owner/repo",
        },
        timeout=30,
    )
    outputs = dict(line.split("=", 1) for line in output.read_text().splitlines() if "=" in line)
    return result, outputs


def test_step_takes_inputs_from_env_not_from_expressions() -> None:
    """`${{ inputs.ref }}` в теле скрипта — подстановка строки формы в код."""

    step = _target_step()
    assert "${{" not in str(step["run"])
    env = step["env"]
    assert isinstance(env, dict)
    assert env["INPUT_REF"] == "${{ inputs.ref }}"
    assert env["RUN_SHA"] == "${{ github.event.workflow_run.head_sha }}"


@pytest.mark.parametrize("input_ref", ["main", ""])
def test_manual_run_of_main_passes_the_tip_sha(tmp_path: Path, input_ref: str) -> None:
    result, outputs = _run(tmp_path, event="workflow_dispatch", input_ref=input_ref)

    assert result.returncode == 0, result.stdout + result.stderr
    assert outputs == {"ref": TIP}


def test_manual_run_of_a_branch_passes_its_sha(tmp_path: Path) -> None:
    result, outputs = _run(tmp_path, event="workflow_dispatch", input_ref="feat/x")

    assert result.returncode == 0, result.stdout + result.stderr
    assert outputs["ref"] == BRANCH_SHA


def test_manual_run_of_a_commit_passes_it_through(tmp_path: Path) -> None:
    result, outputs = _run(tmp_path, event="workflow_dispatch", input_ref=OLD_SHA)

    assert result.returncode == 0, result.stdout + result.stderr
    assert outputs["ref"] == OLD_SHA


@pytest.mark.parametrize("input_ref", ["no-such-branch", "../../user", "$(id)"])
def test_manual_run_of_an_unknown_ref_stops(tmp_path: Path, input_ref: str) -> None:
    result, outputs = _run(tmp_path, event="workflow_dispatch", input_ref=input_ref)

    assert result.returncode != 0
    assert "ref" not in outputs


def test_ci_run_of_the_tip_passes_its_sha(tmp_path: Path) -> None:
    result, outputs = _run(tmp_path, event="workflow_run", run_sha=TIP)

    assert result.returncode == 0, result.stdout + result.stderr
    assert outputs == {"ref": TIP}


def test_ci_run_of_an_old_commit_is_skipped(tmp_path: Path) -> None:
    result, outputs = _run(tmp_path, event="workflow_run", run_sha=OLD_SHA)

    assert result.returncode == 0, result.stdout + result.stderr
    assert outputs == {"stale": "true"}
