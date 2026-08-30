"""Создать первого администратора на пустом стенде.

Без этой команды в свежую установку невозможно войти. Учётные записи заводятся
приглашениями (раздел 11 ТЗ), но пригласить может только тот, кто уже вошёл, —
а первого пользователя не создаёт ни миграция, ни API. Единственным способом
оставался демо-сид, который заводит `admin@example.com` с паролем из открытого
репозитория: на публичном домене это открытая админка, а не стенд.

Запуск на сервере (docs/DEPLOY.md):

    docker compose --env-file .env -f infra/docker-compose.prod.yml \\
        run --rm api python infra/scripts/create_admin.py \\
        --email admin@example.uz --name "Имя Фамилия"

Пароль печатается ОДИН раз и сразу помечается как временный: при первом входе
система потребует задать свой (`password_change_required`). Второй фактор
администратор настраивает сам после входа — записать TOTP-секрет отсюда значило
бы, что он побывал в журнале терминала.

Повторный запуск с тем же адресом ничего не меняет и не перезаписывает пароль:
команда для создания первой учётной записи, а не для сброса доступа. Сброс —
`--reset-password`, и он тоже пишется в журнал аудита.
"""

from __future__ import annotations

import argparse
import asyncio
import secrets
import sys

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.config import get_settings
from core.models import AuditLog
from core.models.enums import UserRole
from core.repositories import users as users_repo

# Длина временного пароля. 24 байта url-safe — это ~32 символа: вводится один
# раз копированием, а подбирать нечего.
TEMP_PASSWORD_BYTES = 24


def _generate_password() -> str:
    return secrets.token_urlsafe(TEMP_PASSWORD_BYTES)


async def create_admin(*, email: str, full_name: str, reset: bool) -> int:
    # Импорт здесь, а не наверху: хеширование живёт в слое API (argon2 с его
    # параметрами), и `core` о нём знать не должен. Тот же приём в seed_demo.py.
    from api.security import hash_password

    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with maker() as session:
            existing = await users_repo.get_by_email(session, email)

            if existing is not None and not reset:
                print(f"Пользователь {email} уже есть — ничего не изменено.")
                print("Сбросить пароль: тот же вызов с --reset-password.")
                return 1

            password = _generate_password()

            if existing is None:
                user = await users_repo.create(
                    session,
                    role=UserRole.ADMIN,
                    full_name=full_name,
                    email=email,
                    password_hash=hash_password(password),
                )
                user.password_change_required = True
                action, what = "create", f"Администратор создан: {full_name} <{email}>"
            else:
                if existing.role is not UserRole.ADMIN:
                    print(
                        f"{email} — это {existing.role.value}, а не администратор. "
                        "Роль меняется в кабинете, а не этой командой."
                    )
                    return 1
                existing.password_hash = hash_password(password)
                existing.password_change_required = True
                # Второй фактор не трогаем: сброс пароля не должен открывать
                # вход тому, у кого нет доступа к приложению-аутентификатору.
                user = existing
                action = "reset_password"
                what = f"Выдан новый временный пароль: {existing.full_name} <{email}>"

            # Правило 7: операции с учётными записями пишутся в журнал. Автора
            # нет — команда запускается человеком с доступом к серверу, и это
            # само по себе факт, который должен остаться в истории.
            session.add(
                AuditLog(
                    user_id=None,
                    action=action,
                    entity="users",
                    entity_id=user.id,
                    after={"email": email, "role": UserRole.ADMIN.value, "via": "create_admin"},
                )
            )
            await session.commit()
            user_id = user.id
    finally:
        await engine.dispose()

    print(what)
    print(f"Идентификатор: {user_id}")
    print()
    print(f"  Временный пароль: {password}")
    print()
    print("Пароль показан один раз и в базе не хранится в открытом виде.")
    print("При первом входе система потребует задать свой; второй фактор")
    print("настраивается там же, в кабинете.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python infra/scripts/create_admin.py",
        description="Создать первого администратора на пустом стенде (раздел 11 ТЗ).",
    )
    parser.add_argument("--email", required=True, help="Рабочий адрес администратора")
    parser.add_argument("--name", required=True, help="Имя и фамилия")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Выдать новый временный пароль существующему администратору",
    )
    args = parser.parse_args(argv)

    if "@" not in args.email:
        parser.error("--email должен быть адресом почты")

    return asyncio.run(
        create_admin(email=args.email, full_name=args.name, reset=args.reset_password)
    )


if __name__ == "__main__":
    sys.exit(main())
