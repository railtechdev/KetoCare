"""Проверка «стенд отвечает снаружи» переживает мигнувшую сеть, но не лежащий стенд.

17.09.2026 два выката из пяти были помечены красным на этом шаге при полностью
живом стенде: `curl: (28) Connection timed out` с раннера GitHub, при том что
сервер отвечал за 10 мс двенадцать раз подряд, а повтор того же коммита проходил.
Раннер ходит до Узбекистана через полмира — чинить нечего, это транзит.

Опасность не в самом ложном красном, а в том, что он приучает не верить
красному: следующий настоящий отказ выката никто не станет смотреть.

Проверяется прогоном самого скрипта из workflow с подделкой `curl`: повторы
должны спасать мигнувшую сеть и НЕ спасать лежащий стенд. Обе половины нужны —
шаг, который никогда не падает, не проверяет ничего.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

_WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "deploy.yml"

#: Подделка curl: печатает код из очереди ответов, по строке на вызов.
#: Исчерпалась очередь — повторяет последний, как повторял бы себя реальный
#: отказ.
_CURL_STUB = """#!/usr/bin/env bash
line=$(head -1 "$CODES")
if [ -n "$line" ]; then
    sed -i '1d' "$CODES" 2>/dev/null || sed -i '' '1d' "$CODES"
    echo "$line" > "$LAST"
else
    line=$(cat "$LAST")
fi
printf '%s' "$line"
[ "$line" = "200" ] || exit 7
"""


def _stand_check_script() -> str:
    """Тело шага берётся из workflow, а не переписывается в тест.

    Копия здесь означала бы, что тест проверяет себя: правка workflow прошла бы
    мимо него молча.
    """

    workflow = yaml.safe_load(_WORKFLOW.read_text())
    for job in workflow["jobs"].values():
        for step in job["steps"]:
            if step.get("name") == "Стенд отвечает снаружи":
                return str(step["run"])
    raise AssertionError("шаг «Стенд отвечает снаружи» исчез из выката")


def _run(tmp_path: Path, codes: list[str]) -> subprocess.CompletedProcess[str]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    curl = fake_bin / "curl"
    curl.write_text(_CURL_STUB)
    curl.chmod(0o755)

    queue = tmp_path / "codes.txt"
    queue.write_text("\n".join(codes) + "\n")

    script = tmp_path / "check.sh"
    # `sleep` между попытками заменяется пустышкой: тест проверяет логику
    # повторов, а не умение ждать, и двадцать секунд ожидания на прогон не
    # окупают ничего.
    script.write_text("sleep() { :; }\n" + _stand_check_script())

    return subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "CODES": str(queue),
            "LAST": str(tmp_path / "last.txt"),
        },
    )


class TestStandCheckSurvivesFlakyTransit:
    def test_single_timeout_does_not_fail_the_deploy(self, tmp_path: Path) -> None:
        """Ровно тот случай, что был дважды: первая попытка не дошла, вторая да."""

        # Две проверки (посадочная и кабинет), у второй первый ответ — отказ.
        result = _run(tmp_path, ["200", "нет ответа", "200"])

        assert result.returncode == 0, result.stdout + result.stderr
        assert "попытка 2" in result.stdout

    def test_dead_stand_still_fails(self, tmp_path: Path) -> None:
        """Обратная сторона: шаг, который никогда не падает, не проверяет ничего."""

        result = _run(tmp_path, ["200", "502"])

        assert result.returncode != 0
        assert "после трёх попыток" in result.stdout + result.stderr

    def test_healthy_stand_does_not_retry(self, tmp_path: Path) -> None:
        """Обычный выкат не растягивается на лишние попытки и ожидания."""

        result = _run(tmp_path, ["200", "200"])

        assert result.returncode == 0
        assert "попытка 2" not in result.stdout
        assert len(re.findall(r"попытка 1", result.stdout)) == 2


def test_both_hosts_are_checked() -> None:
    """Кабинет и посадочная — разные хосты с разными конфигурациями nginx."""

    script = _stand_check_script()

    assert "app.ketocare.railtech.uz" in script
    assert "ketocare.railtech.uz/" in script


@pytest.mark.parametrize("marker", ["for attempt in", "exit 1"])
def test_retry_and_refusal_are_both_present(marker: str) -> None:
    """Страж на случай, если повторы или отказ однажды уберут по отдельности."""

    assert marker in _stand_check_script()
