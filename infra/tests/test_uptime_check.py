"""Монитор доступности отказывает на лежащем стенде и не отказывает на мигнувшем.

Скрипт `infra/scripts/uptime_check.py` гоняется настоящим процессом против
местной подделки стенда: HTTPS-сервер с самоподписанным сертификатом (страницы
и вход) и HTTP-сервер вместо Telegram. Подделка нужна затем же,
что в `test_deploy_stand_check.py`: монитор, который никогда не краснеет, не
проверяет ничего, а краснеющий на каждом мигании транзита приучает не смотреть
на красный. Обе половины здесь под тестом.
"""

from __future__ import annotations

import json
import os
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
_TOKEN = "123456:SECRET-bot-token-never-printed"

pytestmark = pytest.mark.skipif(shutil.which("openssl") is None, reason="нужен openssl")


@dataclass
class Stand:
    """Что отвечает подделка; очереди — ответы по одному на обращение."""

    pages: list[int] = field(default_factory=lambda: [200])
    login: tuple[int, dict[str, object]] = (401, {"error": {"code": "unauthorized"}})
    pending_updates: int = 0
    webhook_url: str = ""
    seen_logins: list[dict[str, str]] = field(default_factory=list)

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
    stand: Running, tmp_path: Path, *, bot: bool = True
) -> tuple[subprocess.CompletedProcess[str], str]:
    report = tmp_path / "report.md"
    env = {k: v for k, v in os.environ.items() if k != "BOT_TOKEN"}
    if bot:
        env["BOT_TOKEN"] = _TOKEN
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
