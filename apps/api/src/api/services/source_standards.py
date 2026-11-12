"""Load the two source documents behind the working catalogue as locked standards.

The working catalogue merges the Ministry guide (Nesterenko 2011) and USDA SR
Legacy (ADR-0067, ADR-0070). Both arrive as files in the repository and are
loaded by the deploy, the same way as the kindergarten documents (ADR-0060):
the stand has no other way to receive them without someone logging in with
an administrator's password and second factor.

Each standard is created, filled through the same CSV parser as the import
endpoint and locked in one transaction. A file with any error, or a row count
that differs from the expected one, loads nothing.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from core.models.enums import CarbsConvention, FoodDietType, FoodStandardKind
from core.repositories import audit as audit_repo
from core.repositories import food_standards as food_standards_repo
from core.repositories import products as products_repo

from .product_import import parse_csv


@dataclass(frozen=True)
class SourceSpec:
    file: str
    rows: int
    name: str
    publisher: str
    version: str
    carbs_convention: CarbsConvention


SOURCES: tuple[SourceSpec, ...] = (
    SourceSpec(
        file="mz-ruz.csv",
        rows=77,
        name="Лечебное питание, Нестеренко В. И. (2011)",
        publisher="Turon-Iqbol; рецензент РНЦЭМП Минздрава РУз",
        version="2011, ISBN 978-9943-14-171-1",
        carbs_convention=CarbsConvention.UNKNOWN,
    ),
    SourceSpec(
        file="usda-sr-legacy.csv",
        rows=76,
        name="USDA FoodData Central SR Legacy",
        publisher="USDA ARS",
        version="2018-04",
        carbs_convention=CarbsConvention.TOTAL,
    ),
)


class SourceLoadError(Exception):
    """The file does not load as a whole; nothing was written."""


async def load_one(
    session: AsyncSession, *, spec: SourceSpec, data_dir: Path, author_id: uuid.UUID
) -> str:
    """Create, fill and lock one standard. Returns a line for the deploy log.

    A standard already present by name is left alone: locked means done, and an
    unlocked one was started by a person, whose work the deploy must not touch.
    """

    existing = await food_standards_repo.find_by_name(session, name=spec.name)
    if existing is not None:
        state = "закрыт" if existing.locked_at is not None else "открыт, не трогаю"
        return f"{spec.name}: уже есть ({state})."

    report = parse_csv((data_dir / spec.file).read_bytes(), allow_unknown=True)
    if not report.ok:
        first = "; ".join(f"строка {e.line}: {e.message}" for e in report.errors[:5])
        raise SourceLoadError(f"{spec.file}: ошибки в файле — {first}")
    if len(report.valid_rows) != spec.rows:
        raise SourceLoadError(f"{spec.file}: строк {len(report.valid_rows)}, ожидалось {spec.rows}")

    fields: dict[str, str] = {
        "name": spec.name,
        "kind": FoodStandardKind.REFERENCE,
        "diet_type": FoodDietType.GENERAL,
        "carbs_convention": spec.carbs_convention,
        "publisher": spec.publisher,
        "version": spec.version,
    }
    standard = await food_standards_repo.create(
        session,
        name=spec.name,
        kind=FoodStandardKind.REFERENCE,
        diet_type=FoodDietType.GENERAL,
        carbs_convention=spec.carbs_convention,
        publisher=spec.publisher,
        version=spec.version,
    )
    await audit_repo.write_audit_log(
        session,
        user_id=author_id,
        action="create",
        entity="food_standards",
        entity_id=standard.id,
        after={key: getattr(value, "value", value) for key, value in fields.items()},
    )

    for row in report.valid_rows:
        values = dict(row.values)
        category = await products_repo.get_or_create_category(
            session, name_ru=values.pop("category")
        )
        if "fiber_100g" in values["unknown_fields"]:
            values["fiber_known"] = False
        await products_repo.create(
            session,
            changed_by=author_id,
            category_id=category.id,
            standard_id=standard.id,
            **values,
        )
    await audit_repo.write_audit_log(
        session,
        user_id=author_id,
        action="import",
        entity="products",
        after={
            "imported": len(report.valid_rows),
            "updated": 0,
            "filename": spec.file,
            "standard_id": str(standard.id),
        },
    )

    locked = await food_standards_repo.lock(session, standard=standard)
    await audit_repo.write_audit_log(
        session,
        user_id=author_id,
        action="lock",
        entity="food_standards",
        entity_id=standard.id,
        after={"locked_at": locked.locked_at.isoformat() if locked.locked_at else None},
    )
    return f"{spec.name}: загружено {len(report.valid_rows)} позиций, стандарт закрыт."
