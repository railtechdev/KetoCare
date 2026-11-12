"""Source standards of the working catalogue, loaded by the deploy (ADR-0071)."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import func, select

from api.services import source_standards
from core.models import AuditLog, Product
from core.models.enums import FoodStandardKind, UserRole
from core.repositories import food_standards as food_standards_repo

pytestmark = pytest.mark.asyncio

DATA = Path(__file__).resolve().parents[3] / "docs" / "import" / "sources"


async def _load_all(session, author_id) -> list[str]:
    return [
        await source_standards.load_one(session, spec=spec, data_dir=DATA, author_id=author_id)
        for spec in source_standards.SOURCES
    ]


async def test_both_sources_load_locked_with_every_row(session, make_user):
    author = await make_user(role=UserRole.ADMIN)
    await _load_all(session, author.id)

    for spec in source_standards.SOURCES:
        standard = await food_standards_repo.find_by_name(session, name=spec.name)
        assert standard is not None
        assert standard.kind is FoodStandardKind.REFERENCE
        assert standard.locked_at is not None
        count = await session.scalar(
            select(func.count()).select_from(Product).where(Product.standard_id == standard.id)
        )
        assert count == spec.rows

    actions = set(
        await session.scalars(select(AuditLog.action).where(AuditLog.user_id == author.id))
    )
    assert {"create", "import", "lock"} <= actions


async def test_second_run_changes_nothing(session, make_user):
    author = await make_user(role=UserRole.ADMIN)
    await _load_all(session, author.id)
    before = await session.scalar(select(func.count()).select_from(Product))

    lines = await _load_all(session, author.id)

    assert all("уже есть" in line for line in lines)
    assert await session.scalar(select(func.count()).select_from(Product)) == before


async def test_wrong_row_count_loads_nothing(session, make_user, tmp_path):
    author = await make_user(role=UserRole.ADMIN)
    spec = source_standards.SOURCES[0]
    lines = (DATA / spec.file).read_text(encoding="utf-8").splitlines(keepends=True)
    (tmp_path / spec.file).write_text("".join(lines[:-1]), encoding="utf-8")

    with pytest.raises(source_standards.SourceLoadError):
        await source_standards.load_one(session, spec=spec, data_dir=tmp_path, author_id=author.id)

    assert await food_standards_repo.find_by_name(session, name=spec.name) is None
