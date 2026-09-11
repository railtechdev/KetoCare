"""Ключ повторной отправки у записи блюда (ADR-0035)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import delete, func, select, update

from core.models import CustomDish, IdempotencyKey, ParentPatient, Product, ProductCategory
from core.models.enums import UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

BUTTER = dict(kcal_100g=717, fat_100g=81.1, protein_100g=0.9, carbs_100g=0.1, fiber_100g=0.0)


async def _product(session) -> Product:
    category = await session.scalar(select(ProductCategory).limit(1))
    if category is None:
        category = ProductCategory(name_ru="Тестовая", sort=0)
        session.add(category)
        await session.flush()
    product = Product(
        name_ru=f"Масло {uuid.uuid4().hex[:8]}",
        category_id=category.id,
        source="USDA",
        source_version="SR28",
        verified_at=date(2026, 1, 1),
        **BUTTER,
    )
    session.add(product)
    await session.flush()
    return product


async def _linked_parent(session, make_user, patient):
    parent = await make_user(UserRole.PARENT)
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent


async def _dishes(session, patient_id: uuid.UUID) -> int:
    total = await session.scalar(
        select(func.count()).select_from(CustomDish).where(CustomDish.patient_id == patient_id)
    )
    return int(total or 0)


def _url(patient) -> str:
    return f"/api/v1/patients/{patient.id}/custom-dishes"


def _body(product: Product, title: str = "Завтрак") -> dict:
    return {"title": title, "ingredients": [{"product_id": str(product.id), "grams": 50}]}


class TestIdempotencyKey:
    async def test_repeat_with_same_key_returns_the_same_dish(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Ответ потерялся, человек нажал ещё раз — второго блюда нет."""
        patient = await make_patient()
        parent = await _linked_parent(session, make_user, patient)
        butter = await _product(session)
        headers = {**auth_headers(parent), "Idempotency-Key": str(uuid.uuid4())}

        first = await client.post(_url(patient), json=_body(butter), headers=headers)
        second = await client.post(_url(patient), json=_body(butter), headers=headers)

        assert first.status_code == 201, first.text
        assert second.status_code == 201, second.text
        assert second.json() == first.json()
        assert await _dishes(session, patient.id) == 1

    async def test_without_key_each_request_creates_a_dish(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Бот и старые клиенты ключа не шлют — для них всё как раньше."""
        patient = await make_patient()
        parent = await _linked_parent(session, make_user, patient)
        butter = await _product(session)

        for _ in range(2):
            response = await client.post(
                _url(patient), json=_body(butter), headers=auth_headers(parent)
            )
            assert response.status_code == 201, response.text

        assert await _dishes(session, patient.id) == 2

    async def test_same_key_with_another_body_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        patient = await make_patient()
        parent = await _linked_parent(session, make_user, patient)
        butter = await _product(session)
        headers = {**auth_headers(parent), "Idempotency-Key": str(uuid.uuid4())}

        await client.post(_url(patient), json=_body(butter), headers=headers)
        other = await client.post(_url(patient), json=_body(butter, "Обед"), headers=headers)

        assert other.status_code == 422, other.text
        assert other.json()["error"]["code"] == "validation_error"
        assert await _dishes(session, patient.id) == 1

    async def test_key_is_scoped_to_the_user(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Совпавшие ключи двух людей не отдают друг другу чужой ответ."""
        patient = await make_patient()
        mother = await _linked_parent(session, make_user, patient)
        father = await _linked_parent(session, make_user, patient)
        butter = await _product(session)
        key = str(uuid.uuid4())

        for parent in (mother, father):
            response = await client.post(
                _url(patient),
                json=_body(butter),
                headers={**auth_headers(parent), "Idempotency-Key": key},
            )
            assert response.status_code == 201, response.text

        assert await _dishes(session, patient.id) == 2

    async def test_repeat_after_access_revoked_is_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Сохранённый ответ не отдаёт данные ребёнка тому, у кого доступ отозван."""
        patient = await make_patient()
        parent = await _linked_parent(session, make_user, patient)
        butter = await _product(session)
        headers = {**auth_headers(parent), "Idempotency-Key": str(uuid.uuid4())}

        first = await client.post(_url(patient), json=_body(butter), headers=headers)
        await session.execute(
            delete(ParentPatient).where(
                ParentPatient.parent_id == parent.id, ParentPatient.patient_id == patient.id
            )
        )
        repeat = await client.post(_url(patient), json=_body(butter), headers=headers)

        assert first.status_code == 201, first.text
        assert repeat.status_code == 403, repeat.text
        assert first.json()["id"] not in repeat.text

    async def test_same_key_for_another_patient_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Путь входит в отпечаток: ответ по одному ребёнку не выдаётся за другого."""
        first_child = await make_patient()
        second_child = await make_patient()
        parent = await _linked_parent(session, make_user, first_child)
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=second_child.id)
        butter = await _product(session)
        headers = {**auth_headers(parent), "Idempotency-Key": str(uuid.uuid4())}

        await client.post(_url(first_child), json=_body(butter), headers=headers)
        other = await client.post(_url(second_child), json=_body(butter), headers=headers)

        assert other.status_code == 422, other.text
        assert other.json()["error"]["details"] == {"header": "Idempotency-Key"}
        assert await _dishes(session, second_child.id) == 0

    async def test_quoted_key_is_the_same_key(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Форма черновика IETF (`"ключ"`) и форма без кавычек — один ключ."""
        patient = await make_patient()
        parent = await _linked_parent(session, make_user, patient)
        butter = await _product(session)
        key = str(uuid.uuid4())

        first = await client.post(
            _url(patient),
            json=_body(butter),
            headers={**auth_headers(parent), "Idempotency-Key": f'"{key}"'},
        )
        second = await client.post(
            _url(patient),
            json=_body(butter),
            headers={**auth_headers(parent), "Idempotency-Key": key},
        )

        assert first.status_code == 201, first.text
        assert second.json() == first.json()
        assert await _dishes(session, patient.id) == 1

    async def test_forbidden_request_does_not_reserve_the_key(
        self, client, session, make_user, make_patient, auth_headers
    ):
        patient = await make_patient()
        stranger = await make_user(UserRole.PARENT)
        butter = await _product(session)
        key = str(uuid.uuid4())

        response = await client.post(
            _url(patient),
            json=_body(butter),
            headers={**auth_headers(stranger), "Idempotency-Key": key},
        )

        assert response.status_code == 403, response.text
        stored = await session.scalar(
            select(func.count()).select_from(IdempotencyKey).where(IdempotencyKey.key == key)
        )
        assert stored == 0

    async def test_invalid_composition_does_not_reserve_the_key(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Исправленный запрос с тем же ключом проходит: отказ 422 ключ не занял."""
        patient = await make_patient()
        parent = await _linked_parent(session, make_user, patient)
        butter = await _product(session)
        headers = {**auth_headers(parent), "Idempotency-Key": str(uuid.uuid4())}
        duplicated = {
            "title": "Завтрак",
            "ingredients": [
                {"product_id": str(butter.id), "grams": 50},
                {"product_id": str(butter.id), "grams": 10},
            ],
        }

        rejected = await client.post(_url(patient), json=duplicated, headers=headers)
        fixed = await client.post(_url(patient), json=_body(butter), headers=headers)

        assert rejected.status_code == 422, rejected.text
        assert fixed.status_code == 201, fixed.text
        assert await _dishes(session, patient.id) == 1

    async def test_expired_key_is_released(
        self, client, session, make_user, make_patient, auth_headers
    ):
        patient = await make_patient()
        parent = await _linked_parent(session, make_user, patient)
        butter = await _product(session)
        key = str(uuid.uuid4())
        headers = {**auth_headers(parent), "Idempotency-Key": key}

        first = await client.post(_url(patient), json=_body(butter), headers=headers)
        await session.execute(
            update(IdempotencyKey)
            .where(IdempotencyKey.key == key)
            .values(created_at=datetime.now(UTC) - timedelta(hours=25))
        )
        second = await client.post(_url(patient), json=_body(butter), headers=headers)

        assert second.status_code == 201, second.text
        assert second.json()["id"] != first.json()["id"]
        assert await _dishes(session, patient.id) == 2

    @pytest.mark.parametrize("key", ["two keys", "a" * 256, "", '""', '"open', 'a"b'])
    async def test_malformed_key_is_rejected(
        self, client, session, make_user, make_patient, auth_headers, key
    ):
        patient = await make_patient()
        parent = await _linked_parent(session, make_user, patient)
        butter = await _product(session)

        response = await client.post(
            _url(patient),
            json=_body(butter),
            headers={**auth_headers(parent), "Idempotency-Key": key},
        )

        assert response.status_code == 422, response.text
        assert await _dishes(session, patient.id) == 0
