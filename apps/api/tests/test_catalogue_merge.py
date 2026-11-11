"""Слияние источников в рабочий справочник: `POST /food-standards/{id}/merge`
(ADR-0067, ADR-0068).

Потребитель — экран сверки в кабинете
(`apps/web/src/features/standards/CatalogueMergeScreen.tsx`): строки с числом,
источником каждого числа и статусом, итоги по статусам.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

import pytest
from sqlalchemy import select

from core.models import AuditLog, FoodStandard, Product, ProductCategory, ProductRevision
from core.models.enums import CarbsConvention, FoodDietType, FoodStandardKind, UserRole

pytestmark = pytest.mark.asyncio


async def _standard(
    session,
    *,
    kind: FoodStandardKind = FoodStandardKind.REFERENCE,
    carbs: CarbsConvention = CarbsConvention.TOTAL,
    locked: bool = True,
    name: str = "Стандарт",
) -> FoodStandard:
    standard = FoodStandard(
        name=f"{name} {uuid.uuid4().hex[:8]}",
        kind=kind,
        diet_type=FoodDietType.GENERAL,
        carbs_convention=carbs,
        locked_at=datetime.now(UTC) if locked and kind is FoodStandardKind.REFERENCE else None,
    )
    session.add(standard)
    await session.flush()
    return standard


async def _category(session) -> ProductCategory:
    category = ProductCategory(name_ru=f"Категория {uuid.uuid4().hex[:8]}", sort=0)
    session.add(category)
    await session.flush()
    return category


async def _product(
    session,
    standard: FoodStandard,
    category: ProductCategory,
    *,
    name: str,
    food_id: uuid.UUID,
    kcal: float,
    fat: float,
    protein: float,
    carbs: float,
    fiber: float = 0,
    unknown: list[str] | None = None,
    waste: float | None = None,
    **extra: Any,
) -> Product:
    unknown = unknown or []
    product = Product(
        name_ru=name,
        standard_id=standard.id,
        food_id=food_id,
        category_id=category.id,
        kcal_100g=kcal,
        fat_100g=fat,
        protein_100g=protein,
        carbs_100g=carbs,
        fiber_100g=fiber,
        fiber_known=extra.pop("fiber_known", "fiber_100g" not in unknown),
        unknown_fields=unknown,
        waste_pct=waste,
        source="Документ",
        source_version="2025",
        verified_at=date(2026, 1, 1),
        **extra,
    )
    session.add(product)
    await session.flush()
    return product


class World:
    """Два источника и пустой рабочий справочник."""

    def __init__(self, mz, usda, target, category) -> None:
        self.mz = mz
        self.usda = usda
        self.target = target
        self.category = category


@pytest.fixture
async def world(session) -> World:
    mz = await _standard(session, carbs=CarbsConvention.UNKNOWN, name="Минздрав РУз")
    usda = await _standard(session, carbs=CarbsConvention.TOTAL, name="USDA")
    target = await _standard(session, kind=FoodStandardKind.CLINIC, name="Рабочий")
    return World(mz, usda, target, await _category(session))


def _name(prefix: str) -> str:
    return f"{prefix} {uuid.uuid4().hex[:6]}"


async def _beef(session, world: World) -> uuid.UUID:
    """Говядина: углеводов и клетчатки у Минздрава нет, у USDA есть."""

    food = uuid.uuid4()
    name = _name("Говядина")
    await _product(
        session,
        world.mz,
        world.category,
        name=name,
        food_id=food,
        kcal=154,
        fat=10,
        protein=15,
        carbs=0,
        unknown=["carbs_100g", "fiber_100g"],
        waste=25,
    )
    await _product(
        session,
        world.usda,
        world.category,
        name=name,
        food_id=food,
        kcal=167,
        fat=9.3,
        protein=20.95,
        carbs=0,
        fiber=0,
    )
    return food


def _ref(product_id: uuid.UUID) -> dict[str, str]:
    return {"kind": "product", "product_id": str(product_id)}


async def _record(session, standard: FoodStandard, food: uuid.UUID) -> uuid.UUID:
    product_id: uuid.UUID = await session.scalar(
        select(Product.id).where(Product.standard_id == standard.id, Product.food_id == food)
    )
    return product_id


async def _cabbage(session, world: World) -> tuple[uuid.UUID, str]:
    """Капуста: углеводы Минздрава (чистые), клетчатка USDA; сборка — 7,2 и 2,5."""

    food = uuid.uuid4()
    name = _name("Капуста")
    await _product(
        session,
        world.mz,
        world.category,
        name=name,
        food_id=food,
        kcal=37,
        fat=0.1,
        protein=1.8,
        carbs=4.7,
        unknown=["fiber_100g"],
    )
    await _product(
        session,
        world.usda,
        world.category,
        name=name,
        food_id=food,
        kcal=25,
        fat=0.1,
        protein=1.28,
        carbs=5.8,
        fiber=2.5,
    )
    return food, name


async def _merge(client, headers, world: World, **body: Any):
    return await client.post(
        f"/api/v1/food-standards/{world.target.id}/merge",
        json={"source_ids": [str(world.mz.id), str(world.usda.id)], **body},
        headers=headers,
    )


def _row(body: dict, food: uuid.UUID) -> dict:
    return next(row for row in body["rows"] if row["food_id"] == str(food))


async def _target_product(session, world: World, food: uuid.UUID) -> Product | None:
    product: Product | None = await session.scalar(
        select(Product).where(Product.standard_id == world.target.id, Product.food_id == food)
    )
    return product


async def test_dry_run_takes_each_field_from_first_known_source(
    client, session, world, make_user, auth_headers
):
    dietitian = await make_user(UserRole.DIETITIAN)
    food = await _beef(session, world)

    response = await _merge(client, auth_headers(dietitian), world)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["applied"] is False
    assert [source["id"] for source in body["sources"]] == [str(world.mz.id), str(world.usda.id)]
    row = _row(body, food)
    assert row["status"] == "new"
    assert row["write"] is True
    fields = row["fields"]
    assert fields["kcal_100g"]["value"] == 154
    assert fields["kcal_100g"]["source_standard_name"] == world.mz.name
    assert fields["fat_100g"]["source_standard_id"] == str(world.mz.id)
    # Прочерк Минздрава — из USDA, как и клетчатка.
    assert fields["carbs_100g"]["value"] == 0
    assert fields["carbs_100g"]["source_standard_id"] == str(world.usda.id)
    assert fields["carbs_100g"]["net_plus_fiber"] is False
    assert fields["fiber_100g"]["source_standard_id"] == str(world.usda.id)
    assert fields["waste_pct"]["value"] == 25
    assert body["totals"]["new"] >= 1
    # Превью ничего не пишет.
    assert await _target_product(session, world, food) is None


async def test_apply_writes_row_with_sources_revision_and_audit(
    client, session, world, make_user, auth_headers
):
    dietitian = await make_user(UserRole.DIETITIAN)
    food = await _beef(session, world)

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    assert response.json()["applied"] is True
    product = await _target_product(session, world, food)
    assert product is not None
    assert float(product.kcal_100g) == 154
    assert float(product.carbs_100g) == 0
    assert float(product.waste_pct) == 25
    assert product.fiber_known is True
    assert product.unknown_fields == []
    mz_beef = await session.scalar(
        select(Product.id).where(Product.standard_id == world.mz.id, Product.food_id == food)
    )
    usda_beef = await session.scalar(
        select(Product.id).where(Product.standard_id == world.usda.id, Product.food_id == food)
    )
    assert product.value_sources["kcal_100g"] == {"kind": "product", "product_id": str(mz_beef)}
    assert product.value_sources["carbs_100g"] == {
        "kind": "product",
        "product_id": str(usda_beef),
    }
    assert product.source.startswith("Слияние: ")

    revisions = await session.scalars(
        select(ProductRevision).where(ProductRevision.product_id == product.id)
    )
    assert len(list(revisions)) == 1
    audit = await session.scalar(
        select(AuditLog).where(
            AuditLog.action == "merge_sources", AuditLog.entity_id == world.target.id
        )
    )
    assert audit is not None
    assert audit.user_id == dietitian.id
    assert audit.after["totals"]["written"] == 1

    # Повторное слияние ничего не меняет.
    again = await _merge(client, auth_headers(dietitian), world)
    assert _row(again.json(), food)["status"] == "unchanged"
    assert _row(again.json(), food)["write"] is False


async def test_net_carbs_source_gets_fiber_added(client, session, world, make_user, auth_headers):
    """Углеводы источника без «с клетчаткой» читаются чистыми (ADR-0068, решение 3)."""

    dietitian = await make_user(UserRole.DIETITIAN)
    food = uuid.uuid4()
    name = _name("Капуста")
    await _product(
        session,
        world.mz,
        world.category,
        name=name,
        food_id=food,
        kcal=37,
        fat=0.1,
        protein=1.8,
        carbs=4.7,
        unknown=["fiber_100g"],
    )
    await _product(
        session,
        world.usda,
        world.category,
        name=name,
        food_id=food,
        kcal=25,
        fat=0.1,
        protein=1.28,
        carbs=5.8,
        fiber=2.5,
    )

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    fields = _row(response.json(), food)["fields"]
    assert fields["carbs_100g"]["value"] == 7.2
    assert fields["carbs_100g"]["net_plus_fiber"] is True
    assert fields["carbs_100g"]["source_standard_id"] == str(world.mz.id)
    assert fields["fiber_100g"]["value"] == 2.5
    assert fields["fiber_100g"]["source_standard_id"] == str(world.usda.id)

    product = await _target_product(session, world, food)
    assert product is not None
    assert float(product.carbs_100g) == 7.2
    assert float(product.fiber_100g) == 2.5
    # Ядро вычтет клетчатку один раз: чистые углеводы — те, что в таблице.
    assert float(product.carbs_100g) - float(product.fiber_100g) == pytest.approx(4.7)
    assert product.value_sources["carbs_100g"]["net_plus_fiber"] is True

    card = await client.get(f"/api/v1/products/{product.id}", headers=auth_headers(dietitian))
    assert card.json()["value_sources"]["carbs_100g"]["net_plus_fiber"] is True


async def test_kcal_mismatch_needs_review_then_accept(
    client, session, world, make_user, auth_headers
):
    dietitian = await make_user(UserRole.DIETITIAN)
    food = uuid.uuid4()
    # 10·9 + 10·4 + 5·4 = 150 против 300 заявленных.
    await _product(
        session,
        world.usda,
        world.category,
        name=_name("Странный"),
        food_id=food,
        kcal=300,
        fat=10,
        protein=10,
        carbs=5,
    )

    preview = await _merge(client, auth_headers(dietitian), world, dry_run=False)
    row = _row(preview.json(), food)
    assert row["status"] == "needs_review"
    assert row["write"] is False
    assert "kcal_mismatch" in row["anomalies"]
    assert await _target_product(session, world, food) is None

    accepted = await _merge(
        client, auth_headers(dietitian), world, dry_run=False, accept=[str(food)]
    )
    row = _row(accepted.json(), food)
    assert row["status"] == "needs_review"
    assert row["accepted"] is True
    assert row["write"] is True
    product = await _target_product(session, world, food)
    assert product is not None
    assert float(product.kcal_100g) == 300


async def test_manual_field_is_kept_and_reported_as_conflict(
    client, session, world, make_user, auth_headers
):
    dietitian = await make_user(UserRole.DIETITIAN)
    food = await _beef(session, world)
    beef_name = await session.scalar(
        select(Product.name_ru).where(Product.standard_id == world.mz.id, Product.food_id == food)
    )
    mz_beef = await _record(session, world.mz, food)
    usda_beef = await _record(session, world.usda, food)
    existing = await _product(
        session,
        world.target,
        world.category,
        name=beef_name,
        food_id=food,
        kcal=150,
        fat=10.3,
        protein=14,
        carbs=0,
        value_sources={
            "kcal_100g": _ref(mz_beef),
            "protein_100g": _ref(mz_beef),
            "carbs_100g": _ref(usda_beef),
            "fiber_100g": _ref(usda_beef),
            "fat_100g": {"kind": "manual", "user_id": str(dietitian.id), "at": "2026-11-01"},
        },
    )

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    row = _row(response.json(), food)
    assert row["status"] == "conflict"
    assert row["product_id"] == str(existing.id)
    fat = row["fields"]["fat_100g"]
    assert fat == {
        **fat,
        "value": 10.3,
        "manual": True,
        "conflict": True,
        "merged": 10,
    }
    await session.refresh(existing)
    # Правка диетолога цела, остальное обновлено из источников.
    assert float(existing.fat_100g) == 10.3
    assert existing.value_sources["fat_100g"]["kind"] == "manual"
    assert float(existing.kcal_100g) == 154
    assert float(existing.protein_100g) == 15


async def test_untracked_values_of_existing_row_are_kept(
    client, session, world, make_user, auth_headers
):
    """Строка, заведённая до `value_sources` (форма, импорт, сиды), — числа
    человека без пометки `manual`. Слияние их не перезаписывает."""

    dietitian = await make_user(UserRole.DIETITIAN)
    food = await _beef(session, world)
    beef_name = await session.scalar(
        select(Product.name_ru).where(Product.standard_id == world.mz.id, Product.food_id == food)
    )
    # Своё `food_id`: строка связана с источником только названием.
    existing = await _product(
        session,
        world.target,
        world.category,
        name=beef_name,
        food_id=uuid.uuid4(),
        kcal=150,
        fat=10,
        protein=14,
        carbs=0,
    )

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    row = _row(response.json(), food)
    assert row["status"] == "conflict"
    assert row["product_id"] == str(existing.id)
    protein = row["fields"]["protein_100g"]
    assert protein["value"] == 14
    assert protein["untracked"] is True
    assert protein["conflict"] is True
    assert protein["merged"] == 15
    # Отходов у строки не было — их заполнить можно.
    assert row["fields"]["waste_pct"]["value"] == 25
    await session.refresh(existing)
    assert float(existing.kcal_100g) == 150
    assert float(existing.protein_100g) == 14
    assert float(existing.waste_pct) == 25


async def test_name_taken_by_another_food_is_not_written(
    client, session, world, make_user, auth_headers
):
    """Два разных продукта с одним названием не пишутся в одну строку."""

    dietitian = await make_user(UserRole.DIETITIAN)
    name = _name("Творог")
    first, second = uuid.uuid4(), uuid.uuid4()
    for standard, food in ((world.mz, first), (world.usda, second)):
        await _product(
            session,
            standard,
            world.category,
            name=name,
            food_id=food,
            kcal=116,
            fat=5,
            protein=16,
            carbs=1.8,
        )

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    rows = [row for row in response.json()["rows"] if row["name_ru"] == name]
    assert sorted(row["status"] for row in rows) == ["conflict", "new"]
    taken = next(row for row in rows if row["status"] == "conflict")
    assert taken["anomalies"] == ["name_taken"]
    assert taken["write"] is False


async def test_row_without_data_in_any_source_is_skipped(
    client, session, world, make_user, auth_headers
):
    dietitian = await make_user(UserRole.DIETITIAN)
    food = uuid.uuid4()
    await _product(
        session,
        world.mz,
        world.category,
        name=_name("Печень"),
        food_id=food,
        kcal=105,
        fat=3.7,
        protein=17.9,
        carbs=0,
        unknown=["carbs_100g", "fiber_100g"],
    )

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    row = _row(response.json(), food)
    assert row["status"] == "no_data"
    assert row["missing"] == ["carbs_100g"]
    assert row["write"] is False
    assert row["fields"]["carbs_100g"]["value"] is None
    assert await _target_product(session, world, food) is None


async def test_parent_cannot_merge(client, session, world, make_user, auth_headers):
    parent = await make_user(UserRole.PARENT)

    response = await _merge(client, auth_headers(parent), world)

    assert response.status_code == 403


@pytest.mark.parametrize("case", ["target_reference", "source_clinic", "duplicate", "empty"])
async def test_validation(client, session, world, make_user, auth_headers, case):
    admin = await make_user(UserRole.ADMIN)
    target = world.target.id
    sources = [str(world.mz.id), str(world.usda.id)]
    if case == "target_reference":
        target = world.usda.id
        sources = [str(world.mz.id)]
    elif case == "source_clinic":
        other = await _standard(session, kind=FoodStandardKind.CLINIC)
        sources = [str(other.id)]
    elif case == "duplicate":
        sources = [str(world.mz.id), str(world.mz.id)]
    else:
        sources = []

    response = await client.post(
        f"/api/v1/food-standards/{target}/merge",
        json={"source_ids": sources},
        headers=auth_headers(admin),
    )

    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"


async def test_unknown_target_is_404(client, world, make_user, auth_headers):
    admin = await make_user(UserRole.ADMIN)

    response = await client.post(
        f"/api/v1/food-standards/{uuid.uuid4()}/merge",
        json={"source_ids": [str(world.mz.id)]},
        headers=auth_headers(admin),
    )

    assert response.status_code == 404


async def test_copy_from_a_clinic_record_is_protected(
    client, session, world, make_user, auth_headers
):
    """Копия из записи другого стандарта клиники несёт `kind = product`, но это
    числа человека: слияние их не заменяет (ADR-0068)."""

    dietitian = await make_user(UserRole.DIETITIAN)
    food = await _beef(session, world)
    beef_name = await _name_of(session, world.mz, food)
    older = await _standard(session, kind=FoodStandardKind.CLINIC, name="Прежний")
    origin = await _product(
        session,
        older,
        world.category,
        name=beef_name,
        food_id=food,
        kcal=150,
        fat=10.3,
        protein=14,
        carbs=0,
    )
    derived = await client.post(
        f"/api/v1/products/{origin.id}/derive",
        json={
            "standard_id": str(world.target.id),
            "name_ru": beef_name,
            "category_id": str(world.category.id),
            "kcal_100g": 150,
            "fat_100g": 10.3,
            "protein_100g": 14,
            "carbs_100g": 0,
            "fiber_100g": 0,
            "source": "Документ",
            "source_version": "2025",
            "verified_at": "2026-01-01",
        },
        headers=auth_headers(dietitian),
    )
    assert derived.status_code == 201, derived.text
    assert derived.json()["value_sources"]["fat_100g"]["kind"] == "product"

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    row = _row(response.json(), food)
    assert row["status"] == "conflict"
    assert row["fields"]["fat_100g"]["value"] == 10.3
    assert row["fields"]["fat_100g"]["conflict"] is True
    assert row["fields"]["kcal_100g"]["value"] == 150
    copy = await session.get(Product, uuid.UUID(derived.json()["id"]))
    await session.refresh(copy)
    assert float(copy.fat_100g) == 10.3
    assert float(copy.kcal_100g) == 150
    assert float(copy.protein_100g) == 14


async def _name_of(session, standard: FoodStandard, food: uuid.UUID) -> str:
    name: str = await session.scalar(
        select(Product.name_ru).where(Product.standard_id == standard.id, Product.food_id == food)
    )
    return name


async def test_manual_carbs_protect_source_fiber(client, session, world, make_user, auth_headers):
    """Углеводы человека — клетчатка из источника остаётся прежней: иначе
    чистые углеводы сдвинулись бы без человека."""

    dietitian = await make_user(UserRole.DIETITIAN)
    food, name = await _cabbage(session, world)
    mz = await _record(session, world.mz, food)
    usda = await _record(session, world.usda, food)
    existing = await _product(
        session,
        world.target,
        world.category,
        name=name,
        food_id=food,
        kcal=37,
        fat=0.1,
        protein=1.8,
        carbs=7.2,
        fiber=1.0,
        value_sources={
            "kcal_100g": _ref(mz),
            "fat_100g": _ref(mz),
            "protein_100g": _ref(mz),
            "carbs_100g": {"kind": "manual", "user_id": str(dietitian.id), "at": "2026-11-01"},
            "fiber_100g": _ref(usda),
        },
    )

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    row = _row(response.json(), food)
    assert row["status"] == "conflict"
    fiber = row["fields"]["fiber_100g"]
    assert (fiber["value"], fiber["merged"], fiber["conflict"]) == (1.0, 2.5, True)
    assert row["fields"]["carbs_100g"]["value"] == 7.2
    await session.refresh(existing)
    assert float(existing.carbs_100g) == 7.2
    assert float(existing.fiber_100g) == 1.0


async def test_manual_fiber_protects_source_carbs(client, session, world, make_user, auth_headers):
    dietitian = await make_user(UserRole.DIETITIAN)
    food, name = await _cabbage(session, world)
    mz = await _record(session, world.mz, food)
    existing = await _product(
        session,
        world.target,
        world.category,
        name=name,
        food_id=food,
        kcal=37,
        fat=0.1,
        protein=1.8,
        carbs=7.0,
        fiber=2.5,
        value_sources={
            "kcal_100g": _ref(mz),
            "fat_100g": _ref(mz),
            "protein_100g": _ref(mz),
            "carbs_100g": _ref(mz),
            "fiber_100g": {"kind": "manual", "user_id": str(dietitian.id), "at": "2026-11-01"},
        },
    )

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    row = _row(response.json(), food)
    assert row["status"] == "conflict"
    carbs = row["fields"]["carbs_100g"]
    assert (carbs["value"], carbs["merged"], carbs["conflict"]) == (7.0, 7.2, True)
    await session.refresh(existing)
    assert float(existing.carbs_100g) == 7.0
    assert float(existing.fiber_100g) == 2.5


async def test_unknown_target_fiber_is_filled_not_protected(
    client, session, world, make_user, auth_headers
):
    """Неизвестная клетчатка цели — пустое место, а не число человека."""

    dietitian = await make_user(UserRole.DIETITIAN)
    food, name = await _cabbage(session, world)
    mz = await _record(session, world.mz, food)
    existing = await _product(
        session,
        world.target,
        world.category,
        name=name,
        food_id=food,
        kcal=37,
        fat=0.1,
        protein=1.8,
        carbs=4.7,
        fiber=0,
        fiber_known=False,
        value_sources={
            "kcal_100g": _ref(mz),
            "fat_100g": _ref(mz),
            "protein_100g": _ref(mz),
            "carbs_100g": _ref(mz),
        },
    )

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    assert _row(response.json(), food)["status"] == "update"
    await session.refresh(existing)
    assert float(existing.fiber_100g) == 2.5
    assert existing.fiber_known is True
    assert float(existing.carbs_100g) == 7.2


async def test_locked_target_is_409(client, session, world, make_user, auth_headers):
    dietitian = await make_user(UserRole.DIETITIAN)
    world.target.locked_at = datetime.now(UTC)
    await session.flush()

    response = await _merge(client, auth_headers(dietitian), world)

    assert response.status_code == 409, response.text


async def test_inactive_target_is_refused(client, session, world, make_user, auth_headers):
    dietitian = await make_user(UserRole.DIETITIAN)
    world.target.is_active = False
    await session.flush()

    response = await _merge(client, auth_headers(dietitian), world)

    assert response.status_code == 422, response.text


async def test_audit_lists_written_products(client, session, world, make_user, auth_headers):
    dietitian = await make_user(UserRole.DIETITIAN)
    food = await _beef(session, world)

    response = await _merge(client, auth_headers(dietitian), world, dry_run=False)

    assert response.status_code == 200, response.text
    product = await _target_product(session, world, food)
    audit = await session.scalar(
        select(AuditLog).where(
            AuditLog.action == "merge_sources", AuditLog.entity_id == world.target.id
        )
    )
    assert str(product.id) in audit.after["product_ids"]
