"""Стандарты питания как сущность API и копия продукта в стандарт клиники (ADR-0057).

Потребитель ручек `/food-standards` и `POST /products/{id}/derive` — кабинет
(`apps/web/src/features/standards`, `features/admin/ProductEditor.tsx`).
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import select

from core.models import DEFAULT_FOOD_STANDARD_ID, AuditLog, FoodStandard, Product, ProductCategory
from core.models.enums import CarbsConvention, FoodDietType, FoodStandardKind, UserRole

pytestmark = pytest.mark.asyncio


async def _standard(
    session,
    *,
    kind: FoodStandardKind = FoodStandardKind.REFERENCE,
    locked: bool = False,
    carbs: CarbsConvention = CarbsConvention.TOTAL,
) -> FoodStandard:
    standard = FoodStandard(
        name=f"Стандарт {uuid.uuid4().hex[:8]}",
        kind=kind,
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
    product = Product(name_ru=name, standard_id=standard_id, **{**_values(category_id), **extra})
    session.add(product)
    await session.flush()
    return product


def _body(product: Product, **changes) -> dict:
    """Тело копии — карточка оригинала, как её подставит форма."""

    body = {
        "name_ru": product.name_ru,
        "name_uz": product.name_uz,
        "name_en": product.name_en,
        "category_id": str(product.category_id),
        "kcal_100g": float(product.kcal_100g),
        "fat_100g": float(product.fat_100g),
        "protein_100g": float(product.protein_100g),
        "carbs_100g": float(product.carbs_100g),
        "fiber_100g": float(product.fiber_100g),
        "source": product.source,
        "source_version": product.source_version,
        "verified_at": str(product.verified_at),
        "counts_in_calculation": product.counts_in_calculation,
    }
    body.update(changes)
    return body


def _create_payload(**changes) -> dict:
    payload = {
        "name": f"Свой стандарт {uuid.uuid4().hex[:8]}",
        "publisher": "Клиника",
        "document": None,
        "version": "1",
        "effective_on": "2026-11-01",
        "kind": "clinic",
        "diet_type": "ketogenic",
        "carbs_convention": "total",
    }
    payload.update(changes)
    return payload


class TestList:
    async def test_staff_sees_standards_with_counts(self, client, session, make_user, auth_headers):
        # Форма ответа — стык с кабинетом: отбор справочника и карточка стандарта.
        doctor = await make_user(UserRole.DOCTOR)
        category = await _category(session)
        other = await _standard(session, locked=True)
        await _product(session, other.id, category.id, f"Молоко {uuid.uuid4().hex[:6]}")

        response = await client.get("/api/v1/food-standards", headers=auth_headers(doctor))

        assert response.status_code == 200, response.text
        items = {item["id"]: item for item in response.json()}
        assert str(DEFAULT_FOOD_STANDARD_ID) in items
        row = items[str(other.id)]
        assert row["products"] == 1
        assert row["locked_at"] is not None
        assert set(row) >= {
            "id",
            "name",
            "publisher",
            "document",
            "version",
            "effective_on",
            "kind",
            "diet_type",
            "carbs_convention",
            "locked_at",
            "is_active",
            "products",
            "created_at",
        }
        # Основной стандарт — первым: с него начинается любой выбор.
        assert response.json()[0]["id"] == str(DEFAULT_FOOD_STANDARD_ID)

    async def test_family_has_no_list(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        response = await client.get("/api/v1/food-standards", headers=auth_headers(parent))

        assert response.status_code == 403, response.text

    async def test_inactive_hidden_unless_asked(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        retired = await _standard(session)
        retired.is_active = False
        await session.flush()

        plain = await client.get("/api/v1/food-standards", headers=auth_headers(admin))
        full = await client.get(
            "/api/v1/food-standards",
            params={"include_inactive": "true"},
            headers=auth_headers(admin),
        )

        assert str(retired.id) not in {item["id"] for item in plain.json()}
        assert str(retired.id) in {item["id"] for item in full.json()}

    async def test_family_has_no_card(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            f"/api/v1/food-standards/{DEFAULT_FOOD_STANDARD_ID}", headers=auth_headers(parent)
        )

        assert response.status_code == 403

    async def test_card_404_for_unknown(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)

        response = await client.get(
            f"/api/v1/food-standards/{uuid.uuid4()}", headers=auth_headers(admin)
        )

        assert response.status_code == 404


class TestCreate:
    @pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.DIETITIAN, UserRole.DOCTOR])
    async def test_editors_create_a_clinic_standard(
        self, client, session, make_user, auth_headers, role
    ):
        user = await make_user(role)

        response = await client.post(
            "/api/v1/food-standards", json=_create_payload(), headers=auth_headers(user)
        )

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["kind"] == "clinic"
        assert body["locked_at"] is None
        assert body["products"] == 0

        audit = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "food_standards",
                AuditLog.entity_id == uuid.UUID(body["id"]),
                AuditLog.action == "create",
            )
        )
        assert audit is not None

    async def test_family_is_forbidden(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/food-standards", json=_create_payload(), headers=auth_headers(parent)
        )

        assert response.status_code == 403

    async def test_net_carbs_convention_is_refused(self, client, make_user, auth_headers):
        # Ядро считает углеводы вместе с клетчаткой: значения «без клетчатки»
        # вычли бы её второй раз (ADR-0056, последствия).
        admin = await make_user(UserRole.ADMIN)

        response = await client.post(
            "/api/v1/food-standards",
            json=_create_payload(carbs_convention="net"),
            headers=auth_headers(admin),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation_error"

    async def test_same_name_is_409(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        existing = await _standard(session)

        response = await client.post(
            "/api/v1/food-standards",
            json=_create_payload(name=f" {existing.name.upper()} "),
            headers=auth_headers(admin),
        )

        assert response.status_code == 409, response.text

    async def test_empty_name_is_422(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)

        response = await client.post(
            "/api/v1/food-standards", json=_create_payload(name="  "), headers=auth_headers(admin)
        )

        assert response.status_code == 422


class TestUpdate:
    async def test_open_standard_is_described(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        standard = await _standard(session, kind=FoodStandardKind.CLINIC)

        response = await client.put(
            f"/api/v1/food-standards/{standard.id}",
            json={"name": "Справочник отделения", "publisher": "Отделение", "is_active": True},
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 200, response.text
        assert response.json()["name"] == "Справочник отделения"
        assert response.json()["publisher"] == "Отделение"

    async def test_locked_standard_changes_only_visibility(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        standard = await _standard(session, locked=True)

        renamed = await client.put(
            f"/api/v1/food-standards/{standard.id}",
            json={"name": "Другое имя", "is_active": True},
            headers=auth_headers(admin),
        )
        hidden = await client.put(
            f"/api/v1/food-standards/{standard.id}",
            json={"name": standard.name, "is_active": False},
            headers=auth_headers(admin),
        )

        assert renamed.status_code == 409, renamed.text
        assert hidden.status_code == 200, hidden.text
        assert hidden.json()["is_active"] is False

    async def test_main_standard_stays_active(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        card = await client.get(
            f"/api/v1/food-standards/{DEFAULT_FOOD_STANDARD_ID}", headers=auth_headers(admin)
        )

        response = await client.put(
            f"/api/v1/food-standards/{DEFAULT_FOOD_STANDARD_ID}",
            json={"name": card.json()["name"], "is_active": False},
            headers=auth_headers(admin),
        )

        assert response.status_code == 409, response.text

    async def test_empty_name_is_422(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        standard = await _standard(session)

        response = await client.put(
            f"/api/v1/food-standards/{standard.id}",
            json={"name": "  ", "is_active": True},
            headers=auth_headers(admin),
        )

        assert response.status_code == 422

    async def test_parent_is_forbidden(self, client, session, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)
        standard = await _standard(session)

        response = await client.put(
            f"/api/v1/food-standards/{standard.id}",
            json={"name": "x", "is_active": True},
            headers=auth_headers(parent),
        )

        assert response.status_code == 403


class TestLock:
    async def test_admin_locks_a_reference_standard(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        standard = await _standard(session)
        product = await _product(session, standard.id, category.id, f"Хлеб {uuid.uuid4().hex[:6]}")

        response = await client.post(
            f"/api/v1/food-standards/{standard.id}/lock", headers=auth_headers(admin)
        )

        assert response.status_code == 200, response.text
        assert response.json()["locked_at"] is not None
        # С этого момента значения не правятся — тем же отказом, что у любого
        # закрытого стандарта.
        edit = await client.put(
            f"/api/v1/products/{product.id}",
            json={**_body(product), "is_active": True},
            headers=auth_headers(admin),
        )
        assert edit.status_code == 409, edit.text

    async def test_lock_is_once(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        standard = await _standard(session, locked=True)

        response = await client.post(
            f"/api/v1/food-standards/{standard.id}/lock", headers=auth_headers(admin)
        )

        assert response.status_code == 409

    async def test_clinic_standard_is_never_locked(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        own = await _standard(session, kind=FoodStandardKind.CLINIC)

        for standard_id in (own.id, DEFAULT_FOOD_STANDARD_ID):
            response = await client.post(
                f"/api/v1/food-standards/{standard_id}/lock", headers=auth_headers(admin)
            )
            assert response.status_code == 409, response.text

    async def test_only_admin_locks(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        standard = await _standard(session)

        response = await client.post(
            f"/api/v1/food-standards/{standard.id}/lock", headers=auth_headers(dietitian)
        )

        assert response.status_code == 403


class TestDerive:
    async def test_copy_keeps_identity_and_origin(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        category = await _category(session)
        locked = await _standard(session, locked=True, carbs=CarbsConvention.UNKNOWN)
        original = await _product(
            session, locked.id, category.id, f"Молоко {uuid.uuid4().hex[:6]}", fiber_known=False
        )

        response = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original),
            headers=auth_headers(dietitian),
        )

        assert response.status_code == 201, response.text
        copy = response.json()
        assert copy["standard_id"] == str(DEFAULT_FOOD_STANDARD_ID)
        assert copy["derived_from_id"] == str(original.id)
        # Одно тождество: исключение ребёнка действует на обе записи.
        assert copy["food_id"] == str(original.food_id)
        # Клетчатку источник не знал, и в копии её не вписали.
        assert copy["fiber_known"] is False

        audit = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "products", AuditLog.entity_id == uuid.UUID(copy["id"])
            )
        )
        assert audit is not None
        assert audit.after["derived_from_id"] == str(original.id)

    async def test_fiber_written_in_the_copy_becomes_known(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True, carbs=CarbsConvention.UNKNOWN)
        original = await _product(
            session,
            locked.id,
            category.id,
            f"Капуста {uuid.uuid4().hex[:6]}",
            fiber_known=False,
            carbs_100g=5,
        )

        response = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original, fiber_100g=2.5, source="Своя сверка", source_version="2026"),
            headers=auth_headers(admin),
        )

        assert response.status_code == 201, response.text
        assert response.json()["fiber_known"] is True

    async def test_copy_named_as_another_food_joins_it(
        self, client, session, make_user, auth_headers
    ):
        # Исключение ребёнка держится на тождестве: копия, названная как другой
        # продукт, обязана попасть под его исключение.
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        original = await _product(
            session, locked.id, category.id, f"Сметана {uuid.uuid4().hex[:6]}"
        )
        other_name = f"Сливки {uuid.uuid4().hex[:6]}"
        other = await _product(session, DEFAULT_FOOD_STANDARD_ID, category.id, other_name)
        extra = await _standard(session, kind=FoodStandardKind.CLINIC)

        response = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original, name_ru=other_name, standard_id=str(extra.id)),
            headers=auth_headers(admin),
        )

        assert response.status_code == 201, response.text
        await session.refresh(original)
        await session.refresh(other)
        assert original.food_id == other.food_id
        assert response.json()["food_id"] == str(other.food_id)

    async def test_fiber_filled_in_by_edit_becomes_known(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        product = await _product(
            session,
            DEFAULT_FOOD_STANDARD_ID,
            category.id,
            f"Свёкла {uuid.uuid4().hex[:6]}",
            fiber_known=False,
            carbs_100g=9,
        )

        response = await client.put(
            f"/api/v1/products/{product.id}",
            json={
                **_body(product, fiber_100g=2, source="Своя сверка", source_version="2026"),
                "is_active": True,
            },
            headers=auth_headers(admin),
        )

        assert response.status_code == 200, response.text
        assert response.json()["fiber_known"] is True

    async def test_family_does_not_see_the_origin_of_a_copy(
        self, client, session, make_user, auth_headers
    ):
        # Иначе идентификатор закрытой записи можно подставить в своё блюдо.
        admin = await make_user(UserRole.ADMIN)
        parent = await make_user(UserRole.PARENT)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        name = f"Кефир {uuid.uuid4().hex[:6]}"
        original = await _product(session, locked.id, category.id, name)
        created = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original),
            headers=auth_headers(admin),
        )
        assert created.status_code == 201, created.text
        copy_id = created.json()["id"]

        card = await client.get(f"/api/v1/products/{copy_id}", headers=auth_headers(parent))
        found = await client.get(
            "/api/v1/products", params={"q": name}, headers=auth_headers(parent)
        )
        staff = await client.get(f"/api/v1/products/{copy_id}", headers=auth_headers(admin))

        assert card.json()["derived_from_id"] is None
        assert found.json()["items"][0]["derived_from_id"] is None
        assert staff.json()["derived_from_id"] == str(original.id)

    async def test_merge_of_foods_is_audited(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        original = await _product(session, locked.id, category.id, f"Айран {uuid.uuid4().hex[:6]}")
        previous = original.food_id
        other_name = f"Катык {uuid.uuid4().hex[:6]}"
        other = await _product(session, DEFAULT_FOOD_STANDARD_ID, category.id, other_name)
        target = await _standard(session, kind=FoodStandardKind.CLINIC)

        response = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original, name_ru=other_name, standard_id=str(target.id)),
            headers=auth_headers(admin),
        )

        assert response.status_code == 201, response.text
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "products",
                AuditLog.action == "merge",
                AuditLog.entity_id == uuid.UUID(response.json()["id"]),
            )
        )
        assert entry is not None
        assert entry.before == {"food_id": str(previous)}
        assert entry.after["food_id"] == str(other.food_id)
        assert str(original.id) in entry.after["product_ids"]

    async def test_new_version_of_the_same_source_is_not_enough(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        original = await _product(session, locked.id, category.id, f"Брынза {uuid.uuid4().hex[:6]}")

        response = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original, fat_100g=30, source_version="2025 x"),
            headers=auth_headers(admin),
        )

        assert response.status_code == 422, response.text

    async def test_retired_standard_takes_no_copies(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        retired = await _standard(session, kind=FoodStandardKind.CLINIC)
        retired.is_active = False
        await session.flush()
        original = await _product(session, locked.id, category.id, f"Лук {uuid.uuid4().hex[:6]}")

        response = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original, standard_id=str(retired.id)),
            headers=auth_headers(admin),
        )

        assert response.status_code == 422, response.text

    async def test_fiber_below_column_precision_stays_unknown(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True, carbs=CarbsConvention.UNKNOWN)
        original = await _product(
            session,
            locked.id,
            category.id,
            f"Огурец {uuid.uuid4().hex[:6]}",
            fiber_known=False,
            carbs_100g=3,
        )

        response = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original, fiber_100g=0.004, source="Своя сверка"),
            headers=auth_headers(admin),
        )

        assert response.status_code == 201, response.text
        assert response.json()["fiber_known"] is False

    async def test_changed_numbers_need_a_new_source(
        self, client, session, make_user, auth_headers
    ):
        # То же правило, что у правки: чужая подпись под своими числами не стоит.
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        original = await _product(session, locked.id, category.id, f"Сыр {uuid.uuid4().hex[:6]}")

        response = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original, fat_100g=30),
            headers=auth_headers(admin),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"]["fields"] == ["fat_100g"]

    async def test_target_must_be_an_open_clinic_standard(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        other_reference = await _standard(session)
        original = await _product(session, locked.id, category.id, f"Рис {uuid.uuid4().hex[:6]}")

        into_locked = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original, standard_id=str(locked.id)),
            headers=auth_headers(admin),
        )
        into_reference = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original, standard_id=str(other_reference.id)),
            headers=auth_headers(admin),
        )

        assert into_locked.status_code == 409, into_locked.text
        assert into_reference.status_code == 422, into_reference.text

    async def test_same_standard_means_edit_instead(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        original = await _product(
            session, DEFAULT_FOOD_STANDARD_ID, category.id, f"Масло {uuid.uuid4().hex[:6]}"
        )

        response = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original),
            headers=auth_headers(admin),
        )

        assert response.status_code == 422, response.text

    async def test_name_taken_in_target_is_409(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        name = f"Творог {uuid.uuid4().hex[:6]}"
        original = await _product(session, locked.id, category.id, name)
        await _product(session, DEFAULT_FOOD_STANDARD_ID, category.id, name)

        response = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original),
            headers=auth_headers(admin),
        )

        assert response.status_code == 409, response.text

    async def test_family_and_unknown_product(self, client, session, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        locked = await _standard(session, locked=True)
        original = await _product(session, locked.id, category.id, f"Яйцо {uuid.uuid4().hex[:6]}")

        forbidden = await client.post(
            f"/api/v1/products/{original.id}/derive",
            json=_body(original),
            headers=auth_headers(parent),
        )
        missing = await client.post(
            f"/api/v1/products/{uuid.uuid4()}/derive",
            json=_body(original),
            headers=auth_headers(admin),
        )

        assert forbidden.status_code == 403
        assert missing.status_code == 404


class TestDoctorEditsCatalogue:
    async def test_doctor_creates_and_edits_a_product(
        self, client, session, make_user, auth_headers
    ):
        # Решение 6 плана: свои продукты ведут и врач, и диетолог (ADR-0057).
        doctor = await make_user(UserRole.DOCTOR)
        category = await _category(session)
        name = f"Орех {uuid.uuid4().hex[:6]}"
        body = _body(Product(name_ru=name, **_values(category.id)), counts_in_calculation=True)

        created = await client.post("/api/v1/products", json=body, headers=auth_headers(doctor))
        assert created.status_code == 201, created.text

        edited = await client.put(
            f"/api/v1/products/{created.json()['id']}",
            json={**body, "name_uz": "Yong'oq", "is_active": True},
            headers=auth_headers(doctor),
        )
        assert edited.status_code == 200, edited.text

    @pytest.mark.parametrize("role", [UserRole.DOCTOR, UserRole.DIETITIAN])
    async def test_editors_import(self, client, make_user, auth_headers, role):
        """ADR-0064: загружают все, кто правит справочник; превью ничего не пишет."""
        editor = await make_user(role)

        response = await client.post(
            "/api/v1/products/import",
            files={"file": ("products.csv", b"name_ru\n", "text/csv")},
            headers=auth_headers(editor),
        )

        assert response.status_code != 403, response.text

    async def test_parent_cannot_import(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/products/import",
            files={"file": ("products.csv", b"name_ru\n", "text/csv")},
            headers=auth_headers(parent),
        )

        assert response.status_code == 403, response.text
