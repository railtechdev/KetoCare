"""Load the 2025 kindergarten documents as a locked `general` food standard (ADR-0060).

Run once by a person, on the stand or locally:

    uv run python infra/scripts/load_dmtt_standard.py --author-email <staff email>

It refuses to run twice, and writes nothing if the catalogue mapping fails.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.services import standard_documents
from core.config import get_settings
from core.repositories import users as users_repo

DATA_DIR = Path(__file__).resolve().parents[1] / "seed" / "dmtt-2025"


async def main(author_email: str) -> int:
    engine = create_async_engine(get_settings().database_url)
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with sessions() as session, session.begin():
            author = await users_repo.get_by_email(session, author_email)
            if author is None:
                print("Учётная запись автора не найдена.")
                return 2
            try:
                report = await standard_documents.load(
                    session, data_dir=DATA_DIR, author_id=author.id
                )
            except standard_documents.DocumentLoadError as error:
                print(f"Не загружено: {error}")
                return 1
    finally:
        await engine.dispose()
    print(report)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--author-email", required=True)
    raise SystemExit(asyncio.run(main(parser.parse_args().author_email)))
