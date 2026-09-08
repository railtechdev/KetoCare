"""Локальный запуск Mini App: привязка чата и подписанная строка запуска.

Зачем. Mini App живёт в кнопке меню чата и получает от Telegram подписанную
строку `initData`; вне Telegram её негде взять, и приложение честно показывает
заглушку. Из-за этого весь экран оставался непроверенным на своей машине — а это
главный канал семьи.

Подпись здесь не подделывается в обход: считается тем же алгоритмом, что и в
`api/services/telegram_initdata.py`, тем же ключом из `BOT_TOKEN`, — то есть
скрипт делает ровно то, что делает Telegram, и только на своей базе. На стенде
и в бою он бесполезен: `BOT_TOKEN` там другой и в репозитории его нет.

Использование:

    uv run python infra/scripts/miniapp_dev_link.py            # родитель из seed_demo
    uv run python infra/scripts/miniapp_dev_link.py --email e2e-parent@example.com

Печатает адрес вида `http://localhost:5174/#tgWebAppData=...` — открыть в
браузере. Привязка чата создаётся один раз и переиспользуется.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "packages" / "core" / "src"))

#: Идентификатор чата, от имени которого «приходит» запуск. Заведомо
#: несуществующий в Telegram: это отладочная привязка, а не чей-то чат.
DEV_CHAT_ID = 777_000_001


def sign_init_data(fields: dict[str, str], *, bot_token: str) -> str:
    """Подпись строки запуска — алгоритм Telegram (тот же, что в тестах API)."""

    check = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    return hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()


def build_init_data(*, chat_id: int, bot_token: str) -> str:
    fields = {
        "user": json.dumps(
            {"id": chat_id, "first_name": "Отладка", "language_code": "ru"},
            ensure_ascii=False,
        ),
        "auth_date": str(int(datetime.now(UTC).timestamp())),
        "query_id": "AAHdF6IQAAAAAN0XohDhrOrc",
    }
    return urlencode({**fields, "hash": sign_init_data(fields, bot_token=bot_token)})


async def ensure_link(email: str, chat_id: int) -> tuple[str, str]:
    from core.db import get_sessionmaker
    from core.models.enums import UserRole
    from core.repositories import access as access_repo
    from core.repositories import patients as patients_repo
    from core.repositories import telegram as telegram_repo
    from core.repositories import users as users_repo

    async with get_sessionmaker()() as session:
        parent = await users_repo.get_by_email(session, email)
        if parent is None or parent.role is not UserRole.PARENT:
            raise SystemExit(f"Родитель {email} не найден — выполните `make seed-demo`.")

        ids = await access_repo.list_accessible_patient_ids(
            session, user_id=parent.id, role=UserRole.PARENT
        )
        if not ids:
            raise SystemExit("У родителя нет детей — выполните `make seed-demo`.")
        patient = await patients_repo.get(session, ids[0])
        if patient is None:
            raise SystemExit("Ребёнок не найден.")

        existing = await telegram_repo.get_active_link_by_chat(session, chat_id)
        if existing is None:
            await telegram_repo.create_link(
                session,
                parent_id=parent.id,
                patient_id=patient.id,
                chat_id=chat_id,
                secret=telegram_repo.generate_binding_secret(),
            )
            await session.commit()
            state = "создана"
        else:
            state = "уже была"

        return patient.full_name, state


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default="parent@example.com")
    parser.add_argument("--chat-id", type=int, default=DEV_CHAT_ID)
    parser.add_argument("--origin", default=os.environ.get("MINIAPP_ORIGIN", "http://localhost:5174"))
    args = parser.parse_args()

    bot_token = os.environ.get("BOT_TOKEN", "")
    if not bot_token:
        raise SystemExit(
            "BOT_TOKEN не задан. Он читается из корневого .env — запускайте через `make miniapp-link`."
        )

    child, state = asyncio.run(ensure_link(args.email, args.chat_id))
    init_data = build_init_data(chat_id=args.chat_id, bot_token=bot_token)

    print(f"Родитель:  {args.email}")
    print(f"Ребёнок:   {child}")
    print(f"Привязка:  {state} (chat_id={args.chat_id})")
    print()
    # Telegram кладёт строку запуска в хеш ОДНИМ закодированным значением:
    # `#tgWebAppData=user%3D...%26auth_date%3D...`. Без кодирования её
    # собственные `&` разрывают строку на отдельные параметры хеша, и
    # приложение читает только первый — «Не удалось открыть кабинет».
    print("Открыть в браузере:")
    print(f"{args.origin}/#tgWebAppData={quote(init_data, safe='')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
