#!/usr/bin/env python3
"""Завести окружение выката в GitHub: секреты, переменные, ключ (ADR-0095).

    github_environment.py production --domain ketocare.uz --server ketocare-prod \\
        --secrets-from ketocare-old
    github_environment.py demo --domain demo.ketocare.uz --server ketocare-demo
    github_environment.py --finish production     # убрать секреты приложения с уровня репозитория

Ни одно значение секрета не печатается и не ложится на диск: значения идут из
источника прямо на вход `gh secret set`. Печатаются только имена.

Откуда значения:

* `production` — из файла окружения прежнего сервера (`--secrets-from`, имя из
  `~/.ssh/config`): секреты приложения обязаны остаться ПРЕЖНИМИ — `SECRET_KEY`
  подписывает сессии и расшифровывает ключи ИИ из кабинета, к `BOT_TOKEN`
  привязаны семьи, а `POSTGRES_PASSWORD` должен совпасть с тем, что получит
  перенесённая база;
* `demo` — служебные секреты генерируются; токен бота, его имя и учётную запись
  администратора человек задаёт сам (Settings → Environments → demo).

Секрет, уже заведённый окружению, не перезаписывается (`--force` — перезаписать):
повторный запуск не должен сменить пароль базы у работающего сервера.

Ключ выката создаётся в памяти (`/dev/shm`), закрытая часть уходит в секрет
`DEPLOY_SSH_KEY`, открытая печатается — её принимает `bootstrap-server.sh`
переменной `DEPLOY_PUBKEY`.
"""

from __future__ import annotations

import argparse
import base64
import os
import secrets as random_secrets
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

#: Секреты приложения: у каждого окружения свои, на уровне репозитория их нет.
APP_SECRETS = (
    "POSTGRES_PASSWORD",
    "SECRET_KEY",
    "BOT_API_TOKEN",
    "BOT_TOKEN",
    "BOT_USERNAME",
    "ANTHROPIC_API_KEY",
    "SETTINGS_ENCRYPTION_KEY",
    "MONITOR_TOKEN",
    "SENTRY_DSN",
    "BACKUP_AGE_RECIPIENT",
    "AI_MODEL_FAST",
    "AI_MODEL_SMART",
)
#: Секреты выката: адрес и ключ сервера.
DEPLOY_SECRETS = ("DEPLOY_HOST", "DEPLOY_USER", "DEPLOY_KNOWN_HOSTS", "DEPLOY_SSH_KEY")
#: Учётная запись первого администратора: на диск сервера не попадает, поэтому
#: с прежнего сервера её не взять — да и на перенесённой базе она уже есть.
ADMIN_SECRETS = ("ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_NAME")
#: Настройки без секретности, которые переезжают с прежнего сервера как есть.
COPIED_VARIABLES = (
    "AI_DAILY_BUDGET_USD",
    "AI_USER_DAILY_LIMIT",
    "AI_PROVIDER_HOSTS",
    "ATTACHMENT_QUOTA_MB",
    "ATTACHMENT_PURGE_DAYS",
    "REPORT_LINK_TTL_HOURS",
    "PUBLIC_CONTACT_EMAIL",
    "PUBLIC_TELEGRAM_URL",
    "BACKUP_REMOTE",
)
#: Генерируются для тестового сервера.
GENERATED = (
    "POSTGRES_PASSWORD",
    "SECRET_KEY",
    "BOT_API_TOKEN",
    "SETTINGS_ENCRYPTION_KEY",
    "MONITOR_TOKEN",
)
#: Что человек задаёт тестовому сам.
BY_HAND = ("BOT_TOKEN", "BOT_USERNAME", *ADMIN_SECRETS)

REMOTE_ENV = "/srv/ketocare/.env"
OWNER = "ketocare"


def _env() -> dict[str, str]:
    # `gh` берёт вход из своей настройки, а не из токена в окружении оболочки.
    return {k: v for k, v in os.environ.items() if k not in ("GH_TOKEN", "GITHUB_TOKEN")}


def gh(*args: str, stdin: str | None = None) -> str:
    done = subprocess.run(
        ["gh", *args], input=stdin, capture_output=True, text=True, env=_env(), check=False
    )
    if done.returncode != 0:
        # stderr `gh` значений не содержит: тело секрета шло на вход.
        sys.exit(f"gh {' '.join(args[:3])}…: {done.stderr.strip()}")
    return done.stdout


def ssh(host: str, command: str) -> str:
    done = subprocess.run(
        ["ssh", "-o", "BatchMode=yes", host, command], capture_output=True, text=True, check=False
    )
    if done.returncode != 0:
        sys.exit(f"ssh {host}: {done.stderr.strip()}")
    return done.stdout


def remote_environment(host: str) -> dict[str, str]:
    """Файл окружения сервера. Значения там пропущены через `shlex.quote`."""

    values: dict[str, str] = {}
    for line in ssh(host, f"cat {REMOTE_ENV}").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, raw = line.split("=", 1)
        parts = shlex.split(raw)
        if parts:
            values[name] = parts[0]
    return values


def existing(kind: str, environment: str | None) -> set[str]:
    scope = ["--env", environment] if environment else []
    listing = gh(kind, "list", *scope, "--json", "name", "--jq", ".[].name")
    return set(listing.split())


def set_secret(name: str, value: str, environment: str | None, *, dry: bool) -> None:
    scope = ["--env", environment] if environment else []
    if not dry:
        gh("secret", "set", name, *scope, stdin=value)
    print(f"  секрет {name}")


def set_variable(name: str, value: str, environment: str | None, *, dry: bool) -> None:
    scope = ["--env", environment] if environment else []
    if not dry:
        gh("variable", "set", name, *scope, "--body", value)
    print(f"  переменная {name} = {value}")


def generated(name: str) -> str:
    if name == "SETTINGS_ENCRYPTION_KEY":
        return base64.urlsafe_b64encode(os.urandom(32)).decode()
    return random_secrets.token_urlsafe(48)


def deploy_key() -> tuple[str, str]:
    """Новая пара ed25519: (закрытая, открытая). Файлы живут в памяти и секунды."""

    shm = "/dev/shm" if Path("/dev/shm").is_dir() else None
    with tempfile.TemporaryDirectory(dir=shm) as directory:
        key = Path(directory) / "key"
        subprocess.run(
            [
                "ssh-keygen",
                "-q",
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                "ketocare-deploy",
                "-f",
                str(key),
            ],
            check=True,
        )
        return key.read_text(), key.with_suffix(".pub").read_text().strip()


def setup(args: argparse.Namespace) -> None:
    environment: str = args.environment
    dry: bool = args.dry_run
    domain: str = args.domain
    repository = gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner").strip()

    print(f"окружение «{environment}» в {repository}" + (" (пробный прогон)" if dry else ""))
    if not dry:
        gh("api", "--method", "PUT", f"repos/{repository}/environments/{environment}")
    # Пока идёт настройка, выкат в это окружение закрыт (deploy.yml, шаг
    # «Окружение настроено»): наполовину заведённые секреты GitHub дополнил бы
    # значениями с уровня репозитория.
    set_variable("ENVIRONMENT_READY", "configuring", environment, dry=dry)
    have = existing("secret", environment) if not dry else set()

    def secret(name: str, value: str) -> None:
        if name in have and not args.force:
            print(f"  секрет {name} — уже есть, не тронут")
            return
        set_secret(name, value, environment, dry=dry)

    source = remote_environment(args.secrets_from) if args.secrets_from else {}
    if environment == "production" and not source:
        sys.exit("production: секреты приложения берутся с прежнего сервера — нужен --secrets-from")

    for name in APP_SECRETS:
        if name in source:
            secret(name, source[name])
        elif environment == "demo" and name in GENERATED:
            secret(name, generated(name))

    for name, value in {
        "LANDING_SITE_URL": f"https://{domain}",
        "PUBLIC_APP_URL": f"https://app.{domain}",
        "WEB_ORIGIN": f"https://app.{domain}",
        "MINIAPP_ORIGIN": f"https://tma.{domain}",
        "TRUSTED_PROXY_IPS": "172.30.100.1",
        "TZ": "Asia/Tashkent",
        "SENTRY_ENVIRONMENT": environment,
        # Тестовый сервер в поиске не нужен: robots.txt отдаёт Disallow.
        **({"LANDING_INDEXABLE": "1"} if environment == "production" else {}),
        **{name: source[name] for name in COPIED_VARIABLES if name in source},
    }.items():
        set_variable(name, value, environment, dry=dry)
    # Адрес Mini App — кнопка в боте. Секретом он лежал исторически; переменная
    # окружения сильнее не станет, поэтому значение пишется туда же, куда читает
    # выкат первым, — в переменные.
    set_variable("MINIAPP_URL", f"https://tma.{domain}", environment, dry=dry)

    # Адрес — тот, по которому на сервер ходит эта машина (HostName из
    # ~/.ssh/config): `hostname -I` на сервере мог бы назвать внутренний.
    resolved = subprocess.run(
        ["ssh", "-G", args.server], capture_output=True, text=True, check=True
    ).stdout
    address = next(
        line.split()[1] for line in resolved.splitlines() if line.startswith("hostname ")
    )
    host_keys = subprocess.run(
        ["ssh-keyscan", "-t", "ed25519", address], capture_output=True, text=True, check=False
    ).stdout.strip()
    if not host_keys:
        sys.exit(f"ssh-keyscan {address}: сервер не отдал ключ")
    # Ключ сервера, полученный сканированием, сверяется с тем, что уже знает
    # эта машина: иначе в known_hosts выката лёг бы ключ того, кто ответил.
    known = subprocess.run(
        ["ssh-keygen", "-F", address], capture_output=True, text=True, check=False
    ).stdout
    scanned = host_keys.split()[-1]
    if scanned not in known:
        sys.exit(
            f"ключ сервера {address} не совпал с записью этой машины — "
            "зайдите на сервер по этому адресу один раз и сверьте отпечаток"
        )
    secret("DEPLOY_HOST", address)
    secret("DEPLOY_USER", OWNER)
    secret("DEPLOY_KNOWN_HOSTS", host_keys)

    if "DEPLOY_SSH_KEY" in have and not args.force:
        print("  секрет DEPLOY_SSH_KEY — уже есть, не тронут (открытая часть уже на сервере)")
    else:
        private, public = deploy_key()
        set_secret("DEPLOY_SSH_KEY", private, environment, dry=dry)
        print("\nоткрытая часть ключа выката — переменной DEPLOY_PUBKEY в bootstrap-server.sh:")
        print(public)

    if environment == "production":
        # Монитор доступности и сверка «что стоит на тестовом» окружениями не
        # пользуются: их значения — уровня репозитория, под своими именами.
        print("уровень репозитория:")
        for name, value in {
            "UPTIME_LANDING_URL": f"https://{domain}/",
            "UPTIME_APP_URL": f"https://app.{domain}/",
            "UPTIME_MINIAPP_URL": f"https://tma.{domain}/",
        }.items():
            set_variable(name, value, None, dry=dry)
        for name, origin in {
            "UPTIME_BOT_TOKEN": "BOT_TOKEN",
            "UPTIME_MONITOR_TOKEN": "MONITOR_TOKEN",
        }.items():
            if origin in source:
                set_secret(name, source[origin], None, dry=dry)
    else:
        print("уровень репозитория:")
        set_variable("DEMO_APP_URL", f"https://app.{domain}", None, dry=dry)
        missing = [name for name in BY_HAND if name not in have]
        if missing:
            print("\nзадать руками (Settings → Environments → demo): " + ", ".join(missing))
            print("затем запустить эту команду ещё раз — выкат откроется только тогда")
            return
    # Последним: всё своё у окружения заведено, выкат в него открыт.
    set_variable("ENVIRONMENT_READY", environment, environment, dry=dry)


def finish(args: argparse.Namespace) -> None:
    """Убрать секреты приложения с уровня репозитория — когда окружения готовы."""

    environment: str = args.environment
    there = existing("secret", environment)
    # Сначала доказательство, что у окружения всё своё: иначе удаление оставило
    # бы сервер без пароля базы на следующем выкате.
    required = {"POSTGRES_PASSWORD", "SECRET_KEY", "BOT_API_TOKEN", "BOT_TOKEN", *DEPLOY_SECRETS}
    absent = sorted(required - there)
    if absent:
        sys.exit(f"у окружения «{environment}» нет: {', '.join(absent)} — удалять рано")
    at_repository = existing("secret", None)
    # `MINIAPP_URL` лежал секретом исторически; теперь это переменная окружения.
    leftovers = {*APP_SECRETS, *DEPLOY_SECRETS, *ADMIN_SECRETS, "MINIAPP_URL"}
    for name in sorted(at_repository & leftovers):
        if not args.dry_run:
            gh("secret", "delete", name)
        print(f"  с уровня репозитория убран {name}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("environment", choices=["demo", "production"])
    parser.add_argument("--domain", help="имя посадочной: ketocare.uz, demo.ketocare.uz")
    parser.add_argument("--server", help="сервер окружения — имя из ~/.ssh/config")
    parser.add_argument(
        "--secrets-from", help="прежний сервер, с которого берутся секреты приложения"
    )
    parser.add_argument("--force", action="store_true", help="перезаписать уже заведённые секреты")
    parser.add_argument("--dry-run", action="store_true", help="только показать имена")
    parser.add_argument(
        "--finish", action="store_true", help="убрать секреты приложения с уровня репозитория"
    )
    args = parser.parse_args()

    if args.finish:
        finish(args)
        return
    if not args.domain or not args.server:
        parser.error("нужны --domain и --server")
    setup(args)


if __name__ == "__main__":
    main()
