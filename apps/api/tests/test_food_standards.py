"""Стандарты питания: продукт принадлежит стандарту (ADR-0056)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest

from core.models import DEFAULT_FOOD_STANDARD_ID, FoodStandard, Product, ProductCategory
from core.models.enums import CarbsConvention, FoodDietType, FoodStandardKind, UserRole
from core.repositories import products as products_repo

pytestmark = pytest.mark.asyncio

CSV_HEADER = (
    "name_ru,category,kcal_100g,fat_100g,protein_100g,carbs_100g,fiber_100g,"
    "source,source_version,verified_at"
)


async def _standard(
    session,
    *,
    locked: bool = False,
    carbs: CarbsConvention = CarbsConvention.TOTAL,
) -> FoodStandard:
    standard = FoodStandard(
        name=f"Стандарт {uuid.uuid4().hex[:8]}",
        kind=FoodStandardKind.REFERENCE,
        diet_type=FoodDietType.GENERAL,
        carbs_convention=carbs,
        locked_at=datetime.now(UTC) if locked else None,
    )
    session.add(standard)
    await session.flush()
    return standard


async def _category(session) -> ProductCategory:
    category = ProductCategory(name_ru=f"Категория {uuid.uuid4().hex[:8]}", sort=0)
    session.add(category)
    await session.flush()
    return category


def _values(category_id) -> dict:
    return {
        "category_id": category_id,
        "kcal_100g": 748,
        "fat_100g": 82.5,
        "protein_100g": 0.5,
        "carbs_100g": 0.8,
        "fiber_100g": 0,
        "source": "Документ",
        "source_version": "2025",
        "verified_at": date(2026, 1, 1),
    }


async def _product(session, standard_id, category_id, name: str, **extra) -> Product:
    product = Product(name_ru=name, standard_id=standard_id, **_values(category_id), **extra)
    session.add(product)
    await session.flush()
    return product


def _payload(category_id, name: str, **extra) -> dict:
    values = _values(category_id)
    return {
        **values,
        "name_ru": name,
        "category_id": str(category_id),
        "verified_at": str(values["verified_at"]),
        **extra,
    }


def _name() -> str:
    return f"Масло {uuid.uuid4().hex[:8]}"


class TestSearch:
    async def test_defaults_to_the_main_standard(self, client, session, make_user, auth_headers):
        # Разбор еды и семья не должны получать один продукт несколько раз.
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        other = await _standard(session)
        name = _name()
        main = await _product(session, DEFAULT_FOOD_STANDARD_ID, category.id, name)
        await _product(session, other.id, category.id, name)

        response = await client.get(
            "/api/v1/products", params={"q": name}, headers=auth_headers(admin)
        )

        assert response.status_code == 200, response.text
        assert [item["id"] for item in response.json()["items"]] == [str(main.id)]

    async def test_specialist_chooses_the_standard(self, client, session, make_user, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)
        category = await _category(session)
        other = await _standard(session)
        name = _name()
        product = await _product(session, other.id, category.id, name)

        response = await client.get(
            "/api/v1/products",
            params={"q": name, "standard_id": str(other.id)},
            headers=auth_headers(doctor),
        )

        assert [item["id"] for item in response.json()["items"]] == [str(product.id)]

    async def test_family_never_reaches_another_standard(
        self, client, session, make_user, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        category = await _category(session)
        other = await _standard(session)
        name = _name()
        await _product(session, other.id, category.id, name)

        response = await client.get(
            "/api/v1/products",
            params={"q": name, "standard_id": str(other.id)},
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
        assert response.json()["items"] == []

    async def test_family_cannot_open_a_record_of_another_standard(
        self, client, session, make_user, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        doctor = await make_user(UserRole.DOCTOR)
        category = await _category(session)
        other = await _standard(session)
        product = await _product(session, other.id, category.id, _name())
        url = f"/api/v1/products/{product.id}"

        assert (await client.get(url, headers=auth_headers(parent))).status_code == 404
        assert (await client.get(url, headers=auth_headers(doctor))).status_code == 200

    async def test_unknown_standard_is_404(self, client, make_user, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)

        response = await client.get(
            "/api/v1/products",
            params={"standard_id": str(uuid.uuid4())},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 404, response.text


class TestNames:
    async def test_same_name_is_allowed_in_another_standard(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        other = await _standard(session)
        name = _name()
        await _product(session, DEFAULT_FOOD_STANDARD_ID, category.id, name)

        response = await client.post(
            "/api/v1/products",
            json=_payload(category.id, name, standard_id=str(other.id)),
            headers=auth_headers(admin),
        )

        assert response.status_code == 201, response.text

    async def test_same_name_is_refused_inside_a_standard(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        name = _name()
        await _product(session, DEFAULT_FOOD_STANDARD_ID, category.id, name)

        response = await client.post(
            "/api/v1/products", json=_payload(category.id, name), headers=auth_headers(admin)
        )

        assert response.status_code == 409, response.text

    async def test_same_name_means_the_same_food(self, client, session, make_user, auth_headers):
        # На этой связи держится исключение ребёнка во всех стандартах.
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        other = await _standard(session)
        name = _name()
        main = await _product(session, DEFAULT_FOOD_STANDARD_ID, category.id, name)

        response = await client.post(
            "/api/v1/products",
            json=_payload(category.id, f" {name.upper()} ", standard_id=str(other.id)),
            headers=auth_headers(admin),
        )

        assert response.json()["food_id"] == str(main.food_id)

    async def test_new_name_gets_its_own_food(self, session, make_user):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        first = await products_repo.create(
            session, changed_by=admin.id, name_ru=_name(), **_values(category.id)
        )
        second = await products_repo.create(
            session, changed_by=admin.id, name_ru=_name(), **_values(category.id)
        )

        assert first.food_id != second.food_id


class TestRename:
    async def test_rename_to_a_name_from_another_standard_joins_all_records(
        self, session, make_user
    ):
        # Переименование не должно разорвать связь: исключение ребёнка держится на ней.
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        first = await _standard(session)
        second = await _standard(session)
        target_name = _name()
        target = await _product(session, first.id, category.id, target_name)
        old_name = _name()
        renamed = await _product(session, DEFAULT_FOOD_STANDARD_ID, category.id, old_name)
        sibling = await _product(session, second.id, category.id, old_name, food_id=renamed.food_id)

        await products_repo.update(
            session, product=renamed, changed_by=admin.id, name_ru=target_name
        )

        found = await products_repo.same_food_ids(session, product_ids=[renamed.id])
        assert found == {target.id, renamed.id, sibling.id}

    async def test_rename_to_a_new_name_keeps_the_food(self, session, make_user):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        product = await _product(session, DEFAULT_FOOD_STANDARD_ID, category.id, _name())
        food_id = product.food_id

        await products_repo.update(session, product=product, changed_by=admin.id, name_ru=_name())

        assert product.food_id == food_id


class TestLockedStandard:
    async def test_category_merge_moves_locked_products(
        self, client, session, make_user, auth_headers
    ):
        # Категория — общая рубрика справочника, а не значение стандарта (ADR-0056).
        admin = await make_user(UserRole.ADMIN)
        source = await _category(session)
        target = await _category(session)
        locked = await _standard(session, locked=True)
        product = await _product(session, locked.id, source.id, _name())

        response = await client.post(
            f"/api/v1/products/categories/{source.id}/merge",
            json={"into_id": str(target.id)},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200, response.text
        await session.refresh(product)
        assert product.category_id == target.id
        assert float(product.fat_100g) == 82.5

    async def test_repository_refuses_changes(self, session, make_user):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        product = await _product(session, locked.id, category.id, _name())

        with pytest.raises(products_repo.StandardLockedError):
            await products_repo.update(session, product=product, changed_by=admin.id, fat_100g=1)
        with pytest.raises(products_repo.StandardLockedError):
            await products_repo.create(
                session,
                changed_by=admin.id,
                standard_id=locked.id,
                name_ru=_name(),
                **_values(category.id),
            )

    async def test_update_is_409_for_an_editor(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        product = await _product(session, locked.id, category.id, _name())

        response = await client.put(
            f"/api/v1/products/{product.id}",
            json=_payload(category.id, product.name_ru, source="Другой", fat_100g=70),
            headers=auth_headers(admin),
        )

        assert response.status_code == 409, response.text
        await session.refresh(product)
        assert float(product.fat_100g) == 82.5

    async def test_create_is_409(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)

        response = await client.post(
            "/api/v1/products",
            json=_payload(category.id, _name(), standard_id=str(locked.id)),
            headers=auth_headers(admin),
        )

        assert response.status_code == 409, response.text

    async def test_import_is_refused_at_preview(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        locked = await _standard(session, locked=True)

        response = await client.post(
            "/api/v1/products/import",
            params={"standard_id": str(locked.id)},
            files={"file": ("p.csv", f"{CSV_HEADER}\n".encode(), "text/csv")},
            headers=auth_headers(admin),
        )

        assert response.status_code == 409, response.text


class TestFiberKnown:
    async def test_unknown_convention_marks_fiber_unknown(self, session, make_user):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        standard = await _standard(session, carbs=CarbsConvention.UNKNOWN)

        product = await products_repo.create(
            session,
            changed_by=admin.id,
            standard_id=standard.id,
            name_ru=_name(),
            **_values(category.id),
        )

        assert product.fiber_known is False

    async def test_main_standard_keeps_fiber_known(self, session, make_user):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)

        product = await products_repo.create(
            session, changed_by=admin.id, name_ru=_name(), **_values(category.id)
        )

        assert product.fiber_known is True


class TestImport:
    async def test_name_from_another_standard_is_not_a_duplicate(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        other = await _standard(session, carbs=CarbsConvention.UNKNOWN)
        name = _name()
        main = await _product(session, DEFAULT_FOOD_STANDARD_ID, category.id, name)
        csv = (
            f"{CSV_HEADER}\n{name},{category.name_ru},748,82.5,0.5,0.8,0,Документ,2025,2026-01-01\n"
        )

        response = await client.post(
            "/api/v1/products/import",
            params={"standard_id": str(other.id), "dry_run": "false"},
            files={"file": ("p.csv", csv.encode(), "text/csv")},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200, response.text
        assert response.json()["imported"] == 1, response.text
        items, _ = await products_repo.search(session, q=name, standard_id=other.id)
        assert items[0].food_id == main.food_id
        assert items[0].fiber_known is False

    async def test_default_import_goes_to_the_main_standard(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        name = _name()
        csv = f"{CSV_HEADER}\n{name},{category.name_ru},717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01\n"

        await client.post(
            "/api/v1/products/import",
            params={"dry_run": "false"},
            files={"file": ("p.csv", csv.encode(), "text/csv")},
            headers=auth_headers(admin),
        )

        items, _ = await products_repo.search(session, q=name)
        assert len(items) == 1
        assert items[0].standard_id == DEFAULT_FOOD_STANDARD_ID
