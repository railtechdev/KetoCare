#!/usr/bin/env python3
"""Завести доступ выката к серверу окружения (ADR-0095).

    github_environment.py demo --domain demo.ketocare.uz --server ketocare-demo
    github_environment.py production --domain ketocare.uz --server ketocare-prod
    github_environment.py production --finish   # убрать секреты прежнего стенда

Секретов приложения и его настроек в GitHub нет: пароль базы и ключи подписи
создаёт сам сервер, адреса и часовой пояс записаны на нём при настройке,
токен бота и ключи ИИ вводятся в кабинете. Здесь заводится только то, чем
выкат заходит на сервер, — секреты уровня репозитория с приставкой окружения
(`DEMO_DEPLOY_*`, `PROD_DEPLOY_*`), — и адреса, по которым выкат проверяет,
что сервер отвечает (`DEMO_APP_URL` и др.).

Окружения GitHub (Settings → Environments) не используются: их заводит только
владелец репозитория, а работа в нём идёт на правах соавтора.

Ключ выката создаётся в памяти (`/dev/shm`), закрытая часть уходит в секрет,
открытая печатается — её принимает `bootstrap-server.sh` переменной
`DEPLOY_PUBKEY`. Уже заведённый ключ не перевыпускается (`--force` —
перевыпустить): его открытая часть уже стоит на сервере.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

PREFIX = {"demo": "DEMO", "production": "PROD"}
#: Доступ выката к серверу — единственное секретное у окружения.
DEPLOY_FIELDS = ("DEPLOY_HOST", "DEPLOY_USER", "DEPLOY_KNOWN_HOSTS", "DEPLOY_SSH_KEY")
#: Что лежало на уровне репозитория, пока сервер был один: значения приложения
#: теперь у сервера и в кабинете, а доступ — под именами с приставкой.
LEGACY_REPOSITORY_NAMES = (
    *DEPLOY_FIELDS,
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
    "MINIAPP_URL",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "ADMIN_NAME",
)
#: Переменные прежнего стенда — адреса и пояс теперь записаны на серверах.
LEGACY_REPOSITORY_VARIABLES = (
    "LANDING_SITE_URL",
    "MINIAPP_ORIGIN",
    "PUBLIC_APP_URL",
    "TRUSTED_PROXY_IPS",
    "TZ",
    "WEB_ORIGIN",
)
OWNER = "ketocare"


def _env() -> dict[str, str]:
    # `gh` берёт вход из своей настройки, а не из токена в окружении оболочки.
    return {k: v for k, v in os.environ.items() if k not in ("GH_TOKEN", "GITHUB_TOKEN")}


def gh(*args: str, stdin: str | None = None) -> str:
    done = subprocess.run(
        ["gh", *args], input=stdin, capture_output=True, text=True, env=_env(), check=False
    )
    if done.returncode != 0:
        # В stderr `gh` значений нет: тело уходило на вход.
        sys.exit(f"gh {' '.join(args[:3])}…: {done.stderr.strip()}")
    return done.stdout


def existing(kind: str) -> set[str]:
    return set(gh(kind, "list", "--json", "name", "--jq", ".[].name").split())


def put_hidden(label: str, body: str, *, dry: bool) -> None:
    if not dry:
        gh("secret", "set", label, stdin=body)
    print(f"  {label} — записан")


def put_variable(label: str, value: str, *, dry: bool) -> None:
    if not dry:
        gh("variable", "set", label, "--body", value)
    print(f"  {label} = {value}")


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


def server_address(alias: str) -> tuple[str, str]:
    """Адрес сервера и его ключ для `known_hosts` выката."""

    # Адрес — тот, по которому на сервер ходит эта машина (HostName из
    # ~/.ssh/config): сам сервер мог бы назвать внутренний.
    resolved = subprocess.run(["ssh", "-G", alias], capture_output=True, text=True, check=True)
    address = next(
        line.split()[1] for line in resolved.stdout.splitlines() if line.startswith("hostname ")
    )
    scanned = subprocess.run(
        ["ssh-keyscan", "-t", "ed25519", address], capture_output=True, text=True, check=False
    ).stdout.strip()
    if not scanned:
        sys.exit(f"ssh-keyscan {address}: сервер не отдал ключ")
    # Сверка с тем, что эта машина уже знает: иначе в known_hosts выката лёг бы
    # ключ того, кто ответил на сканирование.
    known = subprocess.run(
        ["ssh-keygen", "-F", address], capture_output=True, text=True, check=False
    ).stdout
    if scanned.split()[-1] not in known:
        sys.exit(
            f"ключ сервера {address} не совпал с записью этой машины — "
            "зайдите на сервер по этому адресу один раз и сверьте отпечаток"
        )
    return address, scanned


def setup(args: argparse.Namespace) -> None:
    prefix = PREFIX[args.environment]
    dry: bool = args.dry_run
    domain: str = args.domain
    print(f"окружение «{args.environment}»" + (" (пробный прогон)" if dry else ""))

    address, host_key = server_address(args.server)
    have = existing("secret") if not dry else set()
    put_hidden(f"{prefix}_DEPLOY_HOST", address, dry=dry)
    put_hidden(f"{prefix}_DEPLOY_USER", OWNER, dry=dry)
    put_hidden(f"{prefix}_DEPLOY_KNOWN_HOSTS", host_key, dry=dry)
    public = ""
    if f"{prefix}_DEPLOY_SSH_KEY" in have and not args.force:
        print(f"  {prefix}_DEPLOY_SSH_KEY — уже есть, не перевыпущен (открытая часть на сервере)")
    else:
        private, public = deploy_key()
        put_hidden(f"{prefix}_DEPLOY_SSH_KEY", private, dry=dry)

    # Адреса — не настройки приложения, а то, по чему выкат и монитор проверяют,
    # что сервер отвечает. По `DEMO_APP_URL` выкат на боевой сверяет, какой
    # коммит стоит на тестовом.
    put_variable(f"{prefix}_LANDING_URL", f"https://{domain}/", dry=dry)
    put_variable(f"{prefix}_APP_URL", f"https://app.{domain}/", dry=dry)
    if args.environment == "production":
        # Монитор доступности смотрит на боевой.
        put_variable("UPTIME_LANDING_URL", f"https://{domain}/", dry=dry)
        put_variable("UPTIME_APP_URL", f"https://app.{domain}/", dry=dry)
        put_variable("UPTIME_MINIAPP_URL", f"https://tma.{domain}/", dry=dry)

    if public:
        print("\nоткрытая часть ключа выката — переменной DEPLOY_PUBKEY в bootstrap-server.sh:")
        print(public)


def finish(args: argparse.Namespace) -> None:
    """Убрать секреты и переменные прежнего стенда — когда оба сервера заведены."""

    have = existing("secret")
    for prefix in PREFIX.values():
        absent = [f"{prefix}_{field}" for field in DEPLOY_FIELDS if f"{prefix}_{field}" not in have]
        if absent:
            sys.exit(f"не заведены: {', '.join(absent)} — удалять рано")
    for label in sorted(have & set(LEGACY_REPOSITORY_NAMES)):
        if not args.dry_run:
            gh("secret", "delete", label)
        print(f"  убран секрет {label}")
    for label in sorted(existing("variable") & set(LEGACY_REPOSITORY_VARIABLES)):
        if not args.dry_run:
            gh("variable", "delete", label)
        print(f"  убрана переменная {label}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("environment", choices=sorted(PREFIX))
    parser.add_argument("--domain", help="имя посадочной: ketocare.uz, demo.ketocare.uz")
    parser.add_argument("--server", help="сервер окружения — имя из ~/.ssh/config")
    parser.add_argument("--force", action="store_true", help="перевыпустить ключ выката")
    parser.add_argument(
        "--dry-run", action="store_true", help="только показать, что будет записано"
    )
    parser.add_argument(
        "--finish", action="store_true", help="убрать секреты и переменные прежнего стенда"
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
