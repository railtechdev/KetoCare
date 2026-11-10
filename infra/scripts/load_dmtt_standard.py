"""Load the 2025 kindergarten documents as a locked `general` food standard (ADR-0060).

By hand: `uv run python infra/scripts/load_dmtt_standard.py --author-email <staff email>`.
On deploy: `--on-deploy` takes the first administrator as the author, does nothing
if the standard is already there, and loads even if some catalogue links are absent.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.services import standard_documents
from core.config import get_settings
from core.models import User
from core.models.enums import UserRole
from core.repositories import users as users_repo

DATA_DIR = Path(__file__).resolve().parents[1] / "seed" / "dmtt-2025"


async def _author(session: AsyncSession, email: str | None) -> User | None:
    if email is not None:
        return await users_repo.get_by_email(session, email)
    admin: User | None = await session.scalar(
        select(User)
        .where(User.role == UserRole.ADMIN, User.is_active.is_(True))
        .order_by(User.created_at)
        .limit(1)
    )
    return admin


async def main(email: str | None, on_deploy: bool) -> int:
    engine = create_async_engine(get_settings().database_url)
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with sessions() as session, session.begin():
            author = await _author(session, email)
            if author is None:
                print("Стандарт не загружен: нет учётной записи автора.")
                return 0 if on_deploy else 2
            try:
                report = await standard_documents.load(
                    session,
                    data_dir=DATA_DIR,
                    author_id=author.id,
                    require_all_links=not on_deploy,
                )
            except standard_documents.AlreadyLoadedError:
                print("Стандарт уже загружен.")
                return 0
            except standard_documents.DocumentLoadError as error:
                print(f"Не загружено: {error}")
                return 1
    finally:
        await engine.dispose()
    print(report)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--author-email")
    parser.add_argument("--on-deploy", action="store_true")
    args = parser.parse_args()
    if args.author_email is None and not args.on_deploy:
        parser.error("нужен --author-email или --on-deploy")
    raise SystemExit(asyncio.run(main(args.author_email, args.on_deploy)))
