#!/usr/bin/env python3
"""Завести окружение выката в GitHub: адрес сервера, ключ выката, настройки (ADR-0095).

    github_environment.py production --domain ketocare.uz --server ketocare-prod
    github_environment.py demo --domain demo.ketocare.uz --server ketocare-demo
    github_environment.py production --finish   # убрать прежние секреты с уровня репозитория

Секретов приложения здесь нет: пароль базы и ключи подписи создаёт сам сервер
(`server-secrets.sh`), токен бота и ключи ИИ вводятся в кабинете. Окружению в
GitHub нужно только то, чем выкат заходит на сервер, и несекретные настройки —
адреса, часовой пояс.

Ключ выката создаётся в памяти (`/dev/shm`), закрытая часть уходит в секрет
`DEPLOY_SSH_KEY`, открытая печатается — её принимает `bootstrap-server.sh`
переменной `DEPLOY_PUBKEY`. Уже заведённый ключ не перевыпускается
(`--force` — перевыпустить): его открытая часть уже стоит на сервере.

Последней ставится переменная `ENVIRONMENT_READY`: до неё выкат в окружение
закрыт. Значение, которого у окружения нет, GitHub молча берёт с уровня
репозитория — наполовину настроенное окружение выкатилось бы на чужой сервер.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

#: Чем выкат заходит на сервер — единственное секретное у окружения.
DEPLOY_NAMES = ("DEPLOY_HOST", "DEPLOY_USER", "DEPLOY_KNOWN_HOSTS", "DEPLOY_SSH_KEY")
#: Что лежало на уровне репозитория, пока сервер был один, и подлежит удалению:
#: значения приложения теперь у сервера и в кабинете.
LEGACY_REPOSITORY_NAMES = (
    *DEPLOY_NAMES,
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


def existing(kind: str, environment: str | None) -> set[str]:
    scope = ["--env", environment] if environment else []
    return set(gh(kind, "list", *scope, "--json", "name", "--jq", ".[].name").split())


def put_hidden(label: str, body: str, environment: str, *, dry: bool) -> None:
    if not dry:
        gh("secret", "set", label, "--env", environment, stdin=body)
    print(f"  {label} — записан")


def put_variable(label: str, value: str, environment: str | None, *, dry: bool) -> None:
    scope = ["--env", environment] if environment else []
    if not dry:
        gh("variable", "set", label, *scope, "--body", value)
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
    environment: str = args.environment
    dry: bool = args.dry_run
    domain: str = args.domain
    repository = gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner").strip()

    print(f"окружение «{environment}» в {repository}" + (" (пробный прогон)" if dry else ""))
    if not dry:
        gh("api", "--method", "PUT", f"repos/{repository}/environments/{environment}")
    # Пока идёт настройка, выкат в это окружение закрыт (deploy.yml, шаг
    # «Окружение настроено»).
    put_variable("ENVIRONMENT_READY", "configuring", environment, dry=dry)

    for label, value in {
        "LANDING_SITE_URL": f"https://{domain}",
        "PUBLIC_APP_URL": f"https://app.{domain}",
        "WEB_ORIGIN": f"https://app.{domain}",
        "MINIAPP_ORIGIN": f"https://tma.{domain}",
        "MINIAPP_URL": f"https://tma.{domain}",
        "TRUSTED_PROXY_IPS": "172.30.100.1",
        "TZ": "Asia/Tashkent",
        "SENTRY_ENVIRONMENT": environment,
        # Тестовый сервер в поиске не нужен: без переменной robots.txt отдаёт Disallow.
        **({"LANDING_INDEXABLE": "1"} if environment == "production" else {}),
    }.items():
        put_variable(label, value, environment, dry=dry)

    address, host_key = server_address(args.server)
    have = existing("secret", environment) if not dry else set()
    put_hidden("DEPLOY_HOST", address, environment, dry=dry)
    put_hidden("DEPLOY_USER", OWNER, environment, dry=dry)
    put_hidden("DEPLOY_KNOWN_HOSTS", host_key, environment, dry=dry)
    public = ""
    if "DEPLOY_SSH_KEY" in have and not args.force:
        print("  DEPLOY_SSH_KEY — уже есть, не перевыпущен (открытая часть стоит на сервере)")
    else:
        private, public = deploy_key()
        put_hidden("DEPLOY_SSH_KEY", private, environment, dry=dry)

    print("уровень репозитория:")
    if environment == "production":
        # Монитор доступности окружениями не пользуется: его адреса — здесь.
        for label, value in {
            "UPTIME_LANDING_URL": f"https://{domain}/",
            "UPTIME_APP_URL": f"https://app.{domain}/",
            "UPTIME_MINIAPP_URL": f"https://tma.{domain}/",
        }.items():
            put_variable(label, value, None, dry=dry)
    else:
        # По этому адресу выкат на боевой сверяет, какой коммит стоит на тестовом.
        put_variable("DEMO_APP_URL", f"https://app.{domain}", None, dry=dry)

    # Последним: у окружения всё своё, выкат в него открыт.
    put_variable("ENVIRONMENT_READY", environment, environment, dry=dry)

    if public:
        print("\nоткрытая часть ключа выката — переменной DEPLOY_PUBKEY в bootstrap-server.sh:")
        print(public)


def finish(args: argparse.Namespace) -> None:
    """Убрать прежние секреты с уровня репозитория — когда окружения настроены."""

    # Сначала доказательство, что оба окружения ходят на серверы своим ключом:
    # иначе удаление оставило бы выкат без адреса.
    for environment in ("demo", "production"):
        absent = sorted(set(DEPLOY_NAMES) - existing("secret", environment))
        if absent:
            sys.exit(f"у окружения «{environment}» нет: {', '.join(absent)} — удалять рано")
    for label in sorted(existing("secret", None) & set(LEGACY_REPOSITORY_NAMES)):
        if not args.dry_run:
            gh("secret", "delete", label)
        print(f"  с уровня репозитория убран {label}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("environment", choices=["demo", "production"])
    parser.add_argument("--domain", help="имя посадочной: ketocare.uz, demo.ketocare.uz")
    parser.add_argument("--server", help="сервер окружения — имя из ~/.ssh/config")
    parser.add_argument("--force", action="store_true", help="перевыпустить ключ выката")
    parser.add_argument(
        "--dry-run", action="store_true", help="только показать, что будет записано"
    )
    parser.add_argument(
        "--finish", action="store_true", help="убрать прежние секреты с уровня репозитория"
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
