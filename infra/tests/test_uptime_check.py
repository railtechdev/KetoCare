"""Монитор доступности отказывает на лежащем стенде и не отказывает на мигнувшем.

Скрипт `infra/scripts/uptime_check.py` гоняется настоящим процессом против
местной подделки стенда: HTTPS-сервер с самоподписанным сертификатом (страницы
и вход) и HTTP-сервер вместо Telegram. Подделка нужна затем же,
что в `test_deploy_stand_check.py`: монитор, который никогда не краснеет, не
проверяет ничего, а краснеющий на каждом мигании транзита приучает не смотреть
на красный. Обе половины здесь под тестом.
"""

from __future__ import annotations

import ast
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Protocol

import pytest
import yaml

_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT = _ROOT / "infra" / "scripts" / "uptime_check.py"
_WORKFLOW = _ROOT / ".github" / "workflows" / "uptime.yml"
_DEPLOY = _ROOT / ".github" / "workflows" / "deploy.yml"
_TOKEN = "123456:SECRET-bot-token-never-printed"
_MONITOR_TOKEN = "MONITOR-token-never-printed-0123456789abcdef"


def _ai(
    succeeded: int = 5,
    failed: int = 0,
    classes: list[tuple[str, int]] | None = None,
    *,
    stuck: int = 0,
    configured: bool = True,
    budget_exhausted: bool = False,
) -> dict[str, object]:
    """Ответ `/health/ai` той формы, что пинит `apps/api/tests/test_health_ai.py`."""

    return {
        "window_hours": 24,
        "checked_at": "2026-10-08T10:00:00Z",
        "jobs": {"succeeded": succeeded, "failed": failed, "running": 0, "stuck": stuck},
        "last_success_at": None,
        "last_failure_at": None,
        "last_failure_class": classes[0][0] if classes else None,
        "failure_classes": [{"error_class": c, "count": n} for c, n in classes or []],
        "daily_budget_exhausted": budget_exhausted,
        "configured": {"api_key": configured, "model_fast": True, "model_smart": True},
    }


pytestmark = pytest.mark.skipif(shutil.which("openssl") is None, reason="нужен openssl")


@dataclass
class Stand:
    """Что отвечает подделка; очереди — ответы по одному на обращение."""

    pages: list[int] = field(default_factory=lambda: [200])
    login: tuple[int, dict[str, object]] = (401, {"error": {"code": "unauthorized"}})
    pending_updates: int = 0
    webhook_url: str = ""
    seen_logins: list[dict[str, str]] = field(default_factory=list)
    ai_health: tuple[int, dict[str, object]] = field(default_factory=lambda: (200, _ai()))
    seen_ai_auth: list[str] = field(default_factory=list)

    def next_page(self) -> int:
        return self.pages.pop(0) if len(self.pages) > 1 else self.pages[0]


def _handler(stand: Stand) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: object) -> None:
            pass

        def _send(self, status: int, body: object) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            if self.path == f"/bot{_TOKEN}/getMe":
                self._send(200, {"ok": True, "result": {"username": "ketocare_test_bot"}})
            elif self.path == f"/bot{_TOKEN}/getWebhookInfo":
                result = {"url": stand.webhook_url, "pending_update_count": stand.pending_updates}
                self._send(200, {"ok": True, "result": result})
            elif self.path == "/api/v1/health/ai":
                presented = self.headers.get("Authorization", "")
                stand.seen_ai_auth.append(presented)
                if presented != f"Bearer {_MONITOR_TOKEN}":
                    self._send(401, {"error": {"code": "unauthorized"}})
                else:
                    self._send(*stand.ai_health)
            elif self.path.startswith("/bot"):
                self._send(401, {"ok": False, "description": "Unauthorized"})
            else:
                self._send(stand.next_page(), {})

        def do_POST(self) -> None:
            length = int(self.headers.get("Content-Length", 0))
            if self.path == "/api/v1/auth/login":
                stand.seen_logins.append(json.loads(self.rfile.read(length)))
                self._send(*stand.login)
            else:
                self._send(404, {})

    return Handler


def _certificate(tmp: Path, days: int) -> tuple[Path, Path]:
    cert, key = tmp / f"cert-{days}.pem", tmp / f"key-{days}.pem"
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key), "-out", str(cert), "-days", str(days),
            "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
        ],
        check=True,
        capture_output=True,
    )  # fmt: skip
    return cert, key


@dataclass
class Running:
    stand: Stand
    https: str
    telegram: str
    ca_file: Path


class MakeStand(Protocol):
    def __call__(self, stand: Stand, *, cert_days: int = 90) -> Running: ...


@pytest.fixture
def make_stand(tmp_path: Path) -> Iterator[MakeStand]:
    servers: list[ThreadingHTTPServer] = []

    def start(stand: Stand, *, cert_days: int = 90) -> Running:
        cert, key = _certificate(tmp_path, cert_days)
        https = ThreadingHTTPServer(("127.0.0.1", 0), _handler(stand))
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        https.socket = context.wrap_socket(https.socket, server_side=True)
        telegram = ThreadingHTTPServer(("127.0.0.1", 0), _handler(stand))
        for server in (https, telegram):
            servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        return Running(
            stand=stand,
            https=f"https://127.0.0.1:{https.server_address[1]}",
            telegram=f"http://127.0.0.1:{telegram.server_address[1]}",
            ca_file=cert,
        )

    yield start
    for server in servers:
        server.shutdown()


def _run(
    stand: Running,
    tmp_path: Path,
    *,
    bot: bool = True,
    monitor: str | None = None,
) -> tuple[subprocess.CompletedProcess[str], str]:
    report = tmp_path / "report.md"
    env = {k: v for k, v in os.environ.items() if k not in ("BOT_TOKEN", "MONITOR_TOKEN")}
    if bot:
        env["BOT_TOKEN"] = _TOKEN
    if monitor is not None:
        env["MONITOR_TOKEN"] = monitor
    result = subprocess.run(
        [
            sys.executable, str(_SCRIPT),
            "--landing", f"{stand.https}/",
            "--app", f"{stand.https}/",
            "--miniapp", f"{stand.https}/",
            "--telegram-api", stand.telegram,
            "--ca-file", str(stand.ca_file),
            "--attempts", "3", "--backoff", "0", "--timeout", "5",
            "--report", str(report),
        ],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )  # fmt: skip
    return result, report.read_text(encoding="utf-8") if report.exists() else ""


class TestLiveStandPasses:
    def test_everything_answers(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand())

        result, report = _run(stand, tmp_path)

        assert result.returncode == 0, result.stdout + result.stderr
        assert "❌" not in report
        for name in ("страница", "API и база", "сертификат 127.0.0.1", "бот"):
            assert name in result.stdout
        assert "<!-- uptime-failed:  -->" in report

    def test_single_flap_is_not_an_outage(self, make_stand: MakeStand, tmp_path: Path) -> None:
        """Как в выкате: один ответ мимо — не отказ, номер попытки виден."""

        stand = make_stand(Stand(pages=[502, 200]))

        result, _ = _run(stand, tmp_path)

        assert result.returncode == 0, result.stdout + result.stderr
        assert "попытка 2" in result.stdout

    def test_every_login_uses_a_new_address(self, make_stand: MakeStand, tmp_path: Path) -> None:
        """Одна почта на все прогоны заперла бы её счётчиком неудач: 429 вместо 401."""

        stand = make_stand(Stand())

        _run(stand, tmp_path, bot=False)
        _run(stand, tmp_path, bot=False)

        emails = [login["email"] for login in stand.stand.seen_logins]
        assert len(emails) == 2 and len(set(emails)) == 2

    def test_no_bot_token_means_no_bot_check(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand(pending_updates=500))

        result, _ = _run(stand, tmp_path, bot=False)

        assert result.returncode == 0, result.stdout + result.stderr
        assert "бот" not in result.stdout


class TestOutagesAreReported:
    def test_page_down(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand(pages=[502]))

        result, report = _run(stand, tmp_path)

        assert result.returncode == 1
        assert "после 3 попыток" in result.stdout
        assert "❌ **кабинет: страница**" in report

    def test_database_down(self, make_stand: MakeStand, tmp_path: Path) -> None:
        """Страницы — статика nginx и отвечают при лежащем API; база видна только входом."""

        stand = make_stand(Stand(login=(500, {"error": {"code": "internal"}})))

        result, report = _run(stand, tmp_path)

        assert result.returncode == 1
        assert "❌ **API и база** — вход отвечает 500" in report
        assert "<!-- uptime-failed: API и база -->" in report

    def test_401_from_something_else(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand(login=(401, {"detail": "nginx"})))

        result, report = _run(stand, tmp_path)

        assert result.returncode == 1
        assert "401 пришёл не от API" in report

    def test_certificate_close_to_expiry(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand(), cert_days=5)

        result, report = _run(stand, tmp_path)

        assert result.returncode == 1
        assert "сертификат истекает через" in report

    def test_bot_not_taking_updates(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand(pending_updates=40))

        result, report = _run(stand, tmp_path)

        assert result.returncode == 1
        assert "ждут 40 обновлений" in report

    def test_token_never_leaks(self, make_stand: MakeStand, tmp_path: Path) -> None:
        """Журнал прогона публичный: токен бота не печатается ни при каком исходе."""

        stand = make_stand(Stand(webhook_url="https://elsewhere.example"))

        result, report = _run(stand, tmp_path)

        assert result.returncode == 1
        for text in (result.stdout, result.stderr, report):
            assert _TOKEN not in text
            assert _TOKEN.split(":")[1] not in text


class TestWorkflow:
    def test_runs_the_script_on_schedule_and_files_issues(self) -> None:
        workflow = yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))
        triggers = workflow[True]  # YAML 1.1 читает ключ `on` как True
        assert triggers["schedule"][0]["cron"] == "*/15 * * * *"
        assert "workflow_dispatch" in triggers and "workflow_call" in triggers

        job = workflow["jobs"]["check"]
        assert job["permissions"]["issues"] == "write"
        steps = "\n".join(str(step.get("run", "")) for step in job["steps"])
        assert "infra/scripts/uptime_check.py" in steps
        assert "gh issue create" in steps and "gh issue close" in steps

    def test_passes_the_monitor_token_to_the_stand(self) -> None:
        workflow = yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))
        assert "MONITOR_TOKEN" in workflow[True]["workflow_call"]["secrets"]
        check = next(s for s in workflow["jobs"]["check"]["steps"] if s.get("id") == "check")
        assert check["env"]["MONITOR_TOKEN"] == "${{ secrets.MONITOR_TOKEN }}"

    def test_deploy_puts_the_monitor_token_on_the_stand(self) -> None:
        """Тот же секрет обязан доехать до стенда — иначе ручки там нет (404)."""

        workflow = yaml.safe_load(_DEPLOY.read_text(encoding="utf-8"))
        steps = workflow["jobs"]["deploy"]["steps"]
        render = next(s for s in steps if s.get("name") == "Собрать окружение из секретов")
        assert render["env"]["MONITOR_TOKEN"] == "${{ secrets.MONITOR_TOKEN }}"
        script = render["run"]
        start = re.search(r"^\s*NAMES\s*=\s*\[", script, re.M)
        assert start is not None
        bracket = script.index("[", start.start())
        names = ast.literal_eval(script[bracket : script.index("]", bracket) + 1])
        assert "MONITOR_TOKEN" in names


class TestAiHealth:
    """Проверка ИИ: пассивная, по журналу обращений, и только с токеном."""

    def test_healthy(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand())

        result, report = _run(stand, tmp_path, bot=False, monitor=_MONITOR_TOKEN)

        assert result.returncode == 0, result.stdout + result.stderr
        assert "ok   ИИ: обращений к модели за сутки: успешных 5, неудач 0" in result.stdout
        assert stand.stand.seen_ai_auth == [f"Bearer {_MONITOR_TOKEN}"]
        assert "✅ ИИ" in report

    def test_no_token_means_no_ai_check(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand(ai_health=(200, _ai(0, 99, [("APITimeoutError", 99)]))))

        result, _ = _run(stand, tmp_path, bot=False)

        assert result.returncode == 0, result.stdout + result.stderr
        assert "ИИ" not in result.stdout
        assert stand.stand.seen_ai_auth == []

    def test_scoped_key_failure_fails(self, make_stand: MakeStand, tmp_path: Path) -> None:
        """То, что стенд месяц писал в журнал и никто не видел."""

        broken = _ai(0, 12, [("BadRequestError 400 invalid_request_error", 12)])
        stand = make_stand(Stand(ai_health=(200, broken)))

        result, report = _run(stand, tmp_path, bot=False, monitor=_MONITOR_TOKEN)

        assert result.returncode == 1
        assert "❌ **ИИ** — ошибка ключа или настройки модели" in report
        assert "<!-- uptime-failed: ИИ -->" in report

    @pytest.mark.parametrize(
        "error_class",
        [
            "AuthenticationError 401 authentication_error",
            "PermissionDeniedError 403 permission_error",
            "NotFoundError 404 not_found_error",
        ],
    )
    def test_auth_failure_fails_even_with_successes(
        self, make_stand: MakeStand, tmp_path: Path, error_class: str
    ) -> None:
        stand = make_stand(Stand(ai_health=(200, _ai(40, 1, [(error_class, 1)]))))

        result, report = _run(stand, tmp_path, bot=False, monitor=_MONITOR_TOKEN)

        assert result.returncode == 1
        assert error_class in report

    def test_no_success_at_all_fails(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand(ai_health=(200, _ai(0, 3, [("APITimeoutError", 3)]))))

        result, report = _run(stand, tmp_path, bot=False, monitor=_MONITOR_TOKEN)

        assert result.returncode == 1
        assert "ни одного успешного обращения" in report

    def test_key_not_configured_fails(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand(ai_health=(200, _ai(0, 0, configured=False))))

        result, report = _run(stand, tmp_path, bot=False, monitor=_MONITOR_TOKEN)

        assert result.returncode == 1
        assert "не задано: ANTHROPIC_API_KEY" in report

    def test_quiet_day_is_not_an_outage(self, make_stand: MakeStand, tmp_path: Path) -> None:
        """Ночью вызовов может не быть вовсе: «ноль из нуля» — не отказ."""

        stand = make_stand(Stand(ai_health=(200, _ai(0, 0))))

        result, _ = _run(stand, tmp_path, bot=False, monitor=_MONITOR_TOKEN)

        assert result.returncode == 0, result.stdout + result.stderr

    def test_many_transient_failures_only_warn(self, make_stand: MakeStand, tmp_path: Path) -> None:
        flaky = _ai(3, 5, [("APIConnectionError", 3), ("InternalServerError 500 api_error", 2)])
        stand = make_stand(Stand(ai_health=(200, flaky)))

        result, report = _run(stand, tmp_path, bot=False, monitor=_MONITOR_TOKEN)

        assert result.returncode == 0, result.stdout + result.stderr
        assert "::warning::ИИ:" in result.stdout
        assert "неудач больше половины" in result.stdout
        assert "⚠️ ИИ" in report and "❌" not in report

    def test_route_absent_on_stand(self, make_stand: MakeStand, tmp_path: Path) -> None:
        stand = make_stand(Stand(ai_health=(404, {"error": {"code": "not_found"}})))

        result, report = _run(stand, tmp_path, bot=False, monitor=_MONITOR_TOKEN)

        assert result.returncode == 1
        assert "MONITOR_TOKEN пуст или короче 32 знаков" in report

    def test_token_mismatch_fails_and_never_leaks(
        self, make_stand: MakeStand, tmp_path: Path
    ) -> None:
        stand = make_stand(Stand())
        wrong = "WRONG-monitor-token-that-must-not-be-printed-xyz"

        result, report = _run(stand, tmp_path, bot=False, monitor=wrong)

        assert result.returncode == 1
        assert "токен монитора" in report
        for text in (result.stdout, result.stderr, report):
            assert wrong not in text
            assert _MONITOR_TOKEN not in text

    def test_class_from_the_stand_cannot_inject_runner_commands(
        self, make_stand: MakeStand, tmp_path: Path
    ) -> None:
        evil = "BadRequestError 400\n::add-mask::x\n@owner"
        stand = make_stand(Stand(ai_health=(200, _ai(0, 1, [(evil, 1)]))))

        result, report = _run(stand, tmp_path, bot=False, monitor=_MONITOR_TOKEN)

        assert result.returncode == 1
        assert "::add-mask::" not in result.stdout + report
        assert "@owner" not in result.stdout + report
