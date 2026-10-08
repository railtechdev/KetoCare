#!/usr/bin/env python3
"""Монитор доступности стенда: отвечает ли он снаружи, а не только в день выката.

До 07.10.2026 живость стенда проверял один шаг выката («Стенд отвечает
снаружи»), то есть стенд мог пролежать несколько дней, и заметил бы это только
следующий выкат. Скрипт запускает `.github/workflows/uptime.yml` раз в
пятнадцать минут; здесь вся логика проверок, чтобы её можно было прогнать
против местной подделки (`infra/tests/test_uptime_check.py`).

Проверки:

- **страницы** — посадочная, кабинет и Mini App отдают 200;
- **API и база** — `POST /api/v1/auth/login` с заведомо несуществующей почтой
  обязан ответить 401 с кодом `unauthorized`. `/health` для этого не годится:
  nginx его наружу не проксирует, а сам он базы не касается. Вход же ищет
  учётную запись в базе и счётчик неудач в Redis, то есть 401 доказывает
  цепочку nginx → API → postgres → redis. Почта каждый раз новая: счётчик
  неудач по одной почте запер бы её через полсотни прогонов, и монитор начал
  бы получать 429 вместо 401. Записи в `audit_log` несуществующая почта не
  оставляет;
- **сертификаты** — каждый хост отдаёт цепочку, которой верит обычный клиент,
  и до её конца больше `--min-cert-days` дней. certbot продлевает за тридцать
  дней до конца, поэтому меньше четырнадцати значит, что продление не работает;
- **бот** — только если задан `BOT_TOKEN`. `getMe` проверяет, что токен жив, а
  `getWebhookInfo` — что обновления кто-то забирает: бот работает long polling,
  и у живого очередь пуста. Если процесс бота лежит, сообщения семей копятся у
  Telegram (`pending_update_count`), и это единственный признак, видимый
  снаружи. `getUpdates` монитор не вызывает никогда: он отобрал бы обновления
  у работающего бота;
- **ИИ** — только если задан `MONITOR_TOKEN`. `GET /api/v1/health/ai` отдаёт
  сводку журнала `ai_jobs` за сутки: сколько обращений к модели удалось и
  сколько нет, классы неудач, заданы ли ключ и модели. С 08.09.2026 на стенде
  каждое обращение отвечало `400 invalid_request_error` (ключ не привязан к
  workspace), помощник и сводка врача месяц молча показывали шаблоны «сейчас
  недоступно», а монитор был зелёным. Отказ — когда за сутки нет ни одного
  успеха при неудачах, когда среди неудач есть класс ключа или настройки
  (`AUTH_OR_CONFIG_*`) и когда ключ или модель не заданы. Больше половины
  неудач при живых успехах — предупреждение, а не отказ: сбой у Anthropic
  проходит сам и issue не заслуживает. Проверка пассивная — ни одного
  собственного обращения к модели: пробный вызов стоил бы денег каждые
  пятнадцать минут.

Каждая проверка — до `--attempts` попыток с паузой: транзит до Узбекистана
мигает (см. шаг «Стенд отвечает снаружи» в deploy.yml), и одиночный таймаут —
не отказ. Номер удавшейся попытки печатается: деградация пути видна заранее.

Токены бота и монитора не печатаются ни в каком виде: текст ошибки чистится от них.
Только стандартная библиотека — workflow не ставит зависимостей и укладывается
в минуту.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

#: Сколько обновлений может ждать у Telegram, пока бот считается живым. Живой
#: бот забирает их за секунды; десяток — запас на момент перезапуска.
PENDING_UPDATES_MAX = 10

#: Коды HTTP ответа Anthropic, которые значат «не тот ключ или не та настройка»,
#: а не «сервис мигнул». 400 сюда входит потому, что именно им отвечал ключ без
#: workspace; 404 — имя модели, которой нет.
AUTH_OR_CONFIG_CODES = frozenset({"400", "401", "403", "404"})

#: Имена исключений SDK с тем же смыслом — на случай, если кода в классе нет.
AUTH_OR_CONFIG_NAMES = frozenset(
    {"AuthenticationError", "PermissionDeniedError", "NotFoundError", "BadRequestError"}
)

#: Типы ошибок в теле ответа Anthropic с тем же смыслом.
AUTH_OR_CONFIG_TYPES = frozenset(
    {"invalid_request_error", "authentication_error", "permission_error", "not_found_error"}
)

#: Доля неудач, с которой при живых успехах печатается предупреждение.
AI_FAILURE_SHARE_WARN = 0.5


class CheckFailed(Exception):
    """Проверка не прошла; текст уходит в журнал и в issue."""


class Warned(str):
    """Проверка прошла, но с предупреждением: печатается, issue не открывает."""


@dataclass(frozen=True, slots=True)
class Check:
    name: str
    run: Callable[[], str]


@dataclass(frozen=True, slots=True)
class Outcome:
    name: str
    ok: bool
    detail: str
    attempt: int
    warning: bool = False


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Редирект — это ответ, а не повод идти дальше: 301 вместо страницы — отказ."""

    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


def _opener(context: ssl.SSLContext) -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=context))


def _request(
    opener: urllib.request.OpenerDirector,
    url: str,
    *,
    timeout: float,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, bytes]:
    request = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with opener.open(request, timeout=timeout) as response:
            return int(response.status), response.read()
    except urllib.error.HTTPError as error:
        return int(error.code), error.read()
    except (urllib.error.URLError, OSError) as error:
        reason = getattr(error, "reason", error)
        raise CheckFailed(f"нет ответа ({reason})") from None


def page_returns_200(
    opener: urllib.request.OpenerDirector, url: str, timeout: float
) -> Callable[[], str]:
    def run() -> str:
        status, _ = _request(opener, url, timeout=timeout)
        if status != 200:
            raise CheckFailed(f"{url} отдаёт {status}")
        return f"{url} → 200"

    return run


def api_answers_from_database(
    opener: urllib.request.OpenerDirector, base: str, timeout: float
) -> Callable[[], str]:
    url = base.rstrip("/") + "/api/v1/auth/login"

    def run() -> str:
        payload = {
            "email": f"uptime-{secrets.token_hex(8)}@example.com",
            "password": secrets.token_urlsafe(16),
        }
        status, body = _request(
            opener,
            url,
            timeout=timeout,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        if status != 401:
            raise CheckFailed(f"вход отвечает {status}, ожидался 401")
        try:
            code = json.loads(body)["error"]["code"]
        except (ValueError, KeyError, TypeError):
            code = None
        # 401 бывает и у прокси перед API; наш ответ узнаётся по телу.
        if code != "unauthorized":
            raise CheckFailed("401 пришёл не от API: в теле нет error.code=unauthorized")
        return f"{url} → 401 unauthorized"

    return run


def certificate_days_left(not_after: str, now: datetime) -> float:
    """Дней до конца сертификата по полю `notAfter` из `getpeercert()`."""

    expires = datetime.fromtimestamp(ssl.cert_time_to_seconds(not_after), tz=UTC)
    return (expires - now).total_seconds() / 86400


def certificate_is_fresh(
    context: ssl.SSLContext, host: str, port: int, min_days: int, timeout: float
) -> Callable[[], str]:
    def run() -> str:
        try:
            with (
                socket.create_connection((host, port), timeout=timeout) as raw,
                context.wrap_socket(raw, server_hostname=host) as tls,
            ):
                cert = tls.getpeercert()
        except ssl.SSLCertVerificationError as error:
            raise CheckFailed(f"{host}: сертификат не принят ({error.verify_message})") from None
        except OSError as error:
            raise CheckFailed(f"{host}:{port}: нет TLS-соединения ({error})") from None
        not_after = cert.get("notAfter") if cert else None
        if not isinstance(not_after, str):
            raise CheckFailed(f"{host}: в сертификате нет срока действия")
        days = certificate_days_left(not_after, datetime.now(UTC))
        if days <= min_days:
            raise CheckFailed(
                f"{host}: сертификат истекает через {days:.0f} дн. (порог {min_days}) — "
                "продление certbot не работает"
            )
        return f"{host}: сертификат ещё {days:.0f} дн."

    return run


def bot_is_polling(
    opener: urllib.request.OpenerDirector, api: str, token: str, timeout: float
) -> Callable[[], str]:
    def call(method: str) -> dict[str, object]:
        try:
            status, body = _request(
                opener, f"{api.rstrip('/')}/bot{token}/{method}", timeout=timeout
            )
        except CheckFailed as error:
            # Адрес запроса содержит токен; в текст ошибки он попасть не должен.
            raise CheckFailed(f"Telegram {method}: {str(error).replace(token, '***')}") from None
        try:
            answer = json.loads(body)
        except ValueError:
            answer = {}
        if status != 200 or not isinstance(answer, dict) or answer.get("ok") is not True:
            raise CheckFailed(f"Telegram {method} отвечает {status} — токен бота недействителен?")
        result = answer.get("result")
        return result if isinstance(result, dict) else {}

    def run() -> str:
        me = call("getMe")
        hook = call("getWebhookInfo")
        if hook.get("url"):
            raise CheckFailed("у бота задан webhook — long polling при нём не работает")
        pending = hook.get("pending_update_count", 0)
        if isinstance(pending, int) and pending > PENDING_UPDATES_MAX:
            raise CheckFailed(f"у Telegram ждут {pending} обновлений — процесс бота их не забирает")
        return f"бот @{me.get('username', '?')} забирает обновления (в очереди {pending})"

    return run


def is_auth_or_config(error_class: str) -> bool:
    """Класс неудачи значит «ключ или настройка», а не мигание сервиса."""

    # Класс собирает API: «имя исключения [код] [тип ошибки Anthropic]».
    words = error_class.split()
    return bool(words) and (
        words[0] in AUTH_OR_CONFIG_NAMES
        or bool(AUTH_OR_CONFIG_CODES.intersection(words[1:2]))
        or bool(AUTH_OR_CONFIG_TYPES.intersection(words))
    )


def _safe_class(value: object) -> str:
    """Класс ошибки из ответа стенда — тем же узким алфавитом, что собирает API.

    Строка уходит в `::error::` и в тело issue: перевод строки в ней стал бы
    командой раннера (`::add-mask::`, `::stop-commands::`), `@` — упоминанием.
    API и так отдаёт только `[A-Za-z0-9_ =]`, но монитор не обязан верить
    стенду, который он как раз проверяет.
    """

    return re.sub(r"[^A-Za-z0-9_ =]", "", str(value))[:80] or "?"


def judge_ai_health(body: object) -> str:
    """Вердикт по ответу `/health/ai`: строка — живо, `Warned` — живо с оговоркой."""

    if not isinstance(body, dict):
        raise CheckFailed("ответ /health/ai не JSON-объект")
    try:
        jobs = body["jobs"]
        configured = body["configured"]
        succeeded = int(jobs["succeeded"])
        failed = int(jobs["failed"])
        stuck = int(jobs.get("stuck", 0))
        classes = [
            (_safe_class(item["error_class"]), int(item["count"]))
            for item in body["failure_classes"]
        ]
    except (KeyError, TypeError, ValueError):
        raise CheckFailed("ответ /health/ai не той формы — монитор и API разошлись") from None

    missing = [
        name
        for key, name in (
            ("api_key", "ANTHROPIC_API_KEY"),
            ("model_fast", "AI_MODEL_FAST"),
            ("model_smart", "AI_MODEL_SMART"),
        )
        if configured.get(key) is not True
    ]
    if missing:
        raise CheckFailed(f"на стенде не задано: {', '.join(missing)} — ИИ-функции выключены")

    broken = [(name, count) for name, count in classes if is_auth_or_config(name)]
    if broken:
        name, count = broken[0]
        raise CheckFailed(
            f"ошибка ключа или настройки модели: {name} ({count} за сутки, "
            f"успешных {succeeded}) — помощник и сводки отвечают шаблонами"
        )
    if failed > 0 and succeeded == 0:
        top = classes[0][0] if classes else "?"
        raise CheckFailed(
            f"за сутки ни одного успешного обращения к модели, неудач {failed} ({top})"
        )

    summary = f"обращений к модели за сутки: успешных {succeeded}, неудач {failed}"
    notes: list[str] = []
    total = succeeded + failed
    if total and failed / total > AI_FAILURE_SHARE_WARN:
        notes.append(f"неудач больше половины ({classes[0][0] if classes else '?'})")
    if stuck:
        notes.append(f"застряло {stuck}")
    if body.get("daily_budget_exhausted") is True:
        notes.append("дневной бюджет исчерпан")
    if notes:
        return Warned(f"{summary}; внимание: {', '.join(notes)}")
    return summary


def ai_is_healthy(
    opener: urllib.request.OpenerDirector, base: str, token: str, timeout: float
) -> Callable[[], str]:
    url = base.rstrip("/") + "/api/v1/health/ai"

    def run() -> str:
        try:
            status, body = _request(
                opener, url, timeout=timeout, headers={"Authorization": f"Bearer {token}"}
            )
        except CheckFailed as error:
            raise CheckFailed(str(error).replace(token, "***")) from None
        if status == 404:
            raise CheckFailed(
                "ручки /health/ai нет: на стенде MONITOR_TOKEN пуст или короче 32 знаков"
            )
        if status == 401:
            raise CheckFailed(
                "стенд не принял токен монитора: MONITOR_TOKEN в репозитории и на стенде разные"
            )
        if status != 200:
            raise CheckFailed(f"/health/ai отвечает {status}")
        try:
            answer = json.loads(body)
        except ValueError:
            raise CheckFailed("/health/ai вернул не JSON") from None
        return judge_ai_health(answer)

    return run


def run_with_retries(check: Check, attempts: int, backoff: float) -> Outcome:
    detail = ""
    for attempt in range(1, attempts + 1):
        try:
            result = check.run()
            return Outcome(check.name, True, result, attempt, isinstance(result, Warned))
        except CheckFailed as error:
            detail = str(error)
        except Exception as error:  # noqa: BLE001 — сбой проверки тоже отказ, не падение
            detail = f"сбой проверки: {type(error).__name__}"
        if attempt < attempts:
            time.sleep(backoff * attempt)
    return Outcome(check.name, False, detail, attempts)


def build_checks(args: argparse.Namespace) -> list[Check]:
    context = ssl.create_default_context(cafile=args.ca_file)
    opener = _opener(context)
    checks: list[Check] = []
    hosts: dict[str, tuple[str, int]] = {}
    for name, url in (
        ("посадочная", args.landing),
        ("кабинет", args.app),
        ("Mini App", args.miniapp),
    ):
        if not url:
            continue
        checks.append(Check(f"{name}: страница", page_returns_200(opener, url, args.timeout)))
        parts = urlsplit(url)
        if parts.scheme == "https" and parts.hostname:
            hosts.setdefault(parts.hostname, (parts.hostname, parts.port or 443))
    if args.app:
        checks.append(
            Check("API и база", api_answers_from_database(opener, args.app, args.timeout))
        )
    for host, port in hosts.values():
        checks.append(
            Check(
                f"сертификат {host}",
                certificate_is_fresh(context, host, port, args.min_cert_days, args.timeout),
            )
        )
    token = os.environ.get("BOT_TOKEN", "")
    if token:
        checks.append(
            Check(
                "бот",
                bot_is_polling(
                    _opener(ssl.create_default_context()), args.telegram_api, token, args.timeout
                ),
            )
        )
    monitor_token = os.environ.get("MONITOR_TOKEN", "")
    if monitor_token and args.app:
        checks.append(Check("ИИ", ai_is_healthy(opener, args.app, monitor_token, args.timeout)))
    return checks


def _report(outcomes: list[Outcome], environment: str) -> str:
    failed = [o for o in outcomes if not o.ok]
    when = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"<!-- uptime-failed: {','.join(sorted(o.name for o in failed))} -->",
        f"**{environment}**, проверка {when}: не прошли {len(failed)} из {len(outcomes)}.",
        "",
    ]
    lines += [f"- ❌ **{o.name}** — {o.detail}" for o in failed]
    lines += [f"- ⚠️ {o.name} — {o.detail}" for o in outcomes if o.ok and o.warning]
    lines += [f"- ✅ {o.name} — {o.detail}" for o in outcomes if o.ok and not o.warning]
    run_url = os.environ.get("RUN_URL")
    if run_url:
        lines += ["", f"Прогон: {run_url}"]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--environment", default="test")
    parser.add_argument("--landing", default="")
    parser.add_argument("--app", default="")
    parser.add_argument("--miniapp", default="")
    parser.add_argument("--min-cert-days", type=int, default=14)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--backoff", type=float, default=5.0)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--telegram-api", default="https://api.telegram.org")
    # Только для теста: местная подделка подписана своим удостоверяющим центром.
    parser.add_argument("--ca-file", default=None)
    parser.add_argument("--report", type=Path, default=None)
    args = parser.parse_args(argv)

    checks = build_checks(args)
    if not checks:
        print("::error::не задан ни один адрес для проверки")
        return 2

    with ThreadPoolExecutor(max_workers=len(checks)) as pool:
        outcomes = list(
            pool.map(lambda c: run_with_retries(c, args.attempts, args.backoff), checks)
        )

    for o in outcomes:
        if o.ok and o.warning:
            print(f"::warning::{o.name}: {o.detail} (попытка {o.attempt})")
        elif o.ok:
            print(f"ok   {o.name}: {o.detail} (попытка {o.attempt})")
        else:
            print(f"::error::{o.name}: {o.detail} (после {o.attempt} попыток)")
    if args.report is not None:
        args.report.write_text(_report(outcomes, args.environment), encoding="utf-8")
    return 0 if all(o.ok for o in outcomes) else 1


if __name__ == "__main__":
    sys.exit(main())
