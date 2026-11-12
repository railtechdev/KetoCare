"""Load the source standards of the working catalogue (Nesterenko 2011, USDA SR Legacy).

On deploy: `--on-deploy` takes the first active administrator as the author and
skips a standard that is already there. By hand:
`uv run python infra/scripts/load_source_standards.py --author-email <staff email>`.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.services import source_standards
from core.config import get_settings
from core.models import User
from core.models.enums import UserRole
from core.repositories import users as users_repo

DATA_DIR = Path(__file__).resolve().parents[2] / "docs" / "import" / "sources"


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
    failed = False
    try:
        for spec in source_standards.SOURCES:
            # One transaction per standard: a broken file must not hold back the other.
            async with sessions() as session, session.begin():
                author = await _author(session, email)
                if author is None:
                    print("Справочники-источники не загружены: нет учётной записи автора.")
                    return 0 if on_deploy else 2
                try:
                    print(
                        await source_standards.load_one(
                            session, spec=spec, data_dir=DATA_DIR, author_id=author.id
                        )
                    )
                except source_standards.SourceLoadError as error:
                    print(f"Не загружено: {error}")
                    failed = True
    finally:
        await engine.dispose()
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--author-email")
    parser.add_argument("--on-deploy", action="store_true")
    args = parser.parse_args()
    if args.author_email is None and not args.on_deploy:
        parser.error("нужен --author-email или --on-deploy")
    raise SystemExit(asyncio.run(main(args.author_email, args.on_deploy)))
