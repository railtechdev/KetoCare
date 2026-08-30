"""Резервные коды входа (NIST SP 800-63B, §5.1.2 — look-up secrets).

Второй фактор для случая «телефон с приложением недоступен». Без них потерянный
телефон означал потерю учётной записи навсегда: отключить второй фактор нельзя
(раздел 7 ТЗ требует его для admin/doctor/dietitian), сброса не было ни у кого,
а восстановления пароля в продукте нет вовсе.

Коды выдаются один раз — при включении второго фактора — и показываются
владельцу тоже один раз: в базе лежит только sha256. Использованный код не
удаляется, а помечается `used_at`: это след, нужный и журналу, и владельцу.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import UserBackupCode

# Десять кодов — общепринятый набор (Google, GitHub, Microsoft). Меньше пяти не
# переживают серию неудачных попыток, больше двадцати не переписывают на бумагу.
BACKUP_CODE_COUNT = 10

# Пять символов в группе, две группы: 10 знаков алфавита из 31 символа — это
# около 50 бит энтропии, перебор по сети бессмыслен.
BACKUP_CODE_GROUP = 5

# Тот же алфавит, что у кодов привязки Telegram: без 0/O и 1/I/L. Код
# переписывают с экрана на бумагу и потом набирают руками, и каждая опечатка —
# это ещё одна попытка, засчитанная живому коду.
BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_code() -> str:
    """Один резервный код вида `ABCDE-FGHJK`."""

    groups = [
        "".join(secrets.choice(BACKUP_CODE_ALPHABET) for _ in range(BACKUP_CODE_GROUP))
        for _ in range(2)
    ]
    return "-".join(groups)


def normalize(code: str) -> str:
    """Приводит введённое к виду хранения.

    Человек набирает код с бумаги: строчными, без дефиса, с пробелами. Отвергать
    такой ввод значило бы отказывать в доступе за форматирование — при том что
    сам код верен.
    """

    cleaned = "".join(ch for ch in code.upper() if ch in BACKUP_CODE_ALPHABET)
    if len(cleaned) != BACKUP_CODE_GROUP * 2:
        return ""
    return f"{cleaned[:BACKUP_CODE_GROUP]}-{cleaned[BACKUP_CODE_GROUP:]}"


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


async def replace_for_user(session: AsyncSession, *, user_id: uuid.UUID) -> list[str]:
    """Выдаёт новый набор, стирая прежний. Возвращает коды в открытом виде.

    Прежние удаляются физически, а не помечаются: это не клинические данные
    (правило 4 не про них), а оставленный старый набор продолжал бы открывать
    вход после того, как владелец его перевыпустил — именно затем, что прежний
    список мог попасть в чужие руки.
    """

    await session.execute(delete(UserBackupCode).where(UserBackupCode.user_id == user_id))

    codes = [generate_code() for _ in range(BACKUP_CODE_COUNT)]
    session.add_all(UserBackupCode(user_id=user_id, code_hash=hash_code(code)) for code in codes)
    await session.flush()
    return codes


async def consume(session: AsyncSession, *, user_id: uuid.UUID, code: str) -> bool:
    """Гасит код, если он есть и ещё не использован.

    Гашение — одним UPDATE с условием `used_at IS NULL`: проверка и запись в
    двух запросах позволили бы двум одновременным входам использовать один код
    дважды.
    """

    normalized = normalize(code)
    if normalized == "":
        return False

    result = await session.execute(
        update(UserBackupCode)
        .where(
            UserBackupCode.user_id == user_id,
            UserBackupCode.code_hash == hash_code(normalized),
            UserBackupCode.used_at.is_(None),
        )
        .values(used_at=datetime.now(UTC))
        .returning(UserBackupCode.id)
    )
    return result.scalar_one_or_none() is not None


async def count_unused(session: AsyncSession, *, user_id: uuid.UUID) -> int:
    """Сколько кодов осталось. Показывается владельцу: набор кончается молча."""

    result = await session.execute(
        select(func.count())
        .select_from(UserBackupCode)
        .where(UserBackupCode.user_id == user_id, UserBackupCode.used_at.is_(None))
    )
    return int(result.scalar_one())


async def drop_for_user(session: AsyncSession, *, user_id: uuid.UUID) -> None:
    """Стирает набор — при сбросе второго фактора администратором."""

    await session.execute(delete(UserBackupCode).where(UserBackupCode.user_id == user_id))
