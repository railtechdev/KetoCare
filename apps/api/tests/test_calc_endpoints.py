"""`/calc` — тонкие обёртки над keto_engine (раздел 5.3 ТЗ).

Проверяется контракт ручек, а не математика (она покрыта эталонами в
packages/keto_engine): корректность маппинга, наличие engine_version,
человекочитаемая причина при неразрешимости, границы входа.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from core.models import Product, ProductCategory
from core.models.enums import UserRole
from core.repositories import patients as patients_repo
from keto_engine import ENGINE_VERSION

pytestmark = pytest.mark.asyncio

BUTTER = {
    "product_id": "butter",
    "kcal": 717,
    "fat": 81.1,
    "protein": 0.9,
    "carbs": 0.1,
    "fiber": 0,
}
CHICKEN = {
    "product_id": "chicken",
    "kcal": 165,
    "fat": 3.6,
    "protein": 31.0,
    "carbs": 0,
    "fiber": 0,
}
BROCCOLI = {
    "product_id": "broccoli",
    "kcal": 34,
    "fat": 0.4,
    "protein": 2.8,
    "carbs": 6.6,
    "fiber": 2.6,
}


class TestVerify:
    async def test_happy_path_returns_totals_and_engine_version(
        self, client, session, make_user, auth_headers
    ):
        user = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/calc/verify",
            json={
                "ingredients": [BUTTER, CHICKEN],
                "items": [
                    {"product_id": "butter", "grams": 50},
                    {"product_id": "chicken", "grams": 40},
                ],
            },
            headers=auth_headers(user),
        )
        assert response.status_code == 200, response.text
        dish = response.json()["dish"]
        # 50 г масла + 40 г курицы: жиры 40.55+1.44, белки 0.45+12.4
        assert dish["fat_g"] == pytest.approx(41.99, abs=0.01)
        assert dish["protein_g"] == pytest.approx(12.85, abs=0.01)
        assert dish["engine_version"] == ENGINE_VERSION

    async def test_tolerance_reported_when_targets_given(
        self, client, session, make_user, auth_headers
    ):
        user = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/calc/verify",
            json={
                "ingredients": [BUTTER, CHICKEN],
                "items": [
                    {"product_id": "butter", "grams": 50},
                    {"product_id": "chicken", "grams": 40},
                ],
                "targets": {"ratio": 3.0, "kcal": 430},
            },
            headers=auth_headers(user),
        )
        body = response.json()
        assert body["ratio_within_tolerance"] is not None
        assert body["kcal_within_tolerance"] is not None

    async def test_item_referencing_unknown_product_rejected(
        self, client, session, make_user, auth_headers
    ):
        user = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/calc/verify",
            json={
                "ingredients": [BUTTER],
                "items": [{"product_id": "not-in-list", "grams": 10}],
            },
            headers=auth_headers(user),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"


class TestSolve:
    async def test_solves_within_tolerance(self, client, session, make_user, auth_headers):
        user = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [BUTTER, CHICKEN, BROCCOLI],
                "targets": {"ratio": 4.0, "kcal": 400},
            },
            headers=auth_headers(user),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["ratio_within_tolerance"] is True
        assert body["kcal_within_tolerance"] is True
        assert abs(body["dish"]["ratio"] - 4.0) <= 0.15
        assert body["dish"]["engine_version"] == ENGINE_VERSION

    async def test_infeasible_returns_human_readable_reason(
        self, client, session, make_user, auth_headers
    ):
        """Раздел 8.3 ТЗ: infeasible показывается причиной, а не ошибкой."""
        user = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [
                    {
                        "product_id": "a",
                        "kcal": 100,
                        "fat": 0,
                        "protein": 20,
                        "carbs": 5,
                        "fiber": 0,
                    }
                ],
                "targets": {"ratio": 4.0, "kcal": 300},
            },
            headers=auth_headers(user),
        )
        assert response.status_code == 422
        error = response.json()["error"]
        assert error["code"] == "infeasible_calculation"
        assert "жировой компонент" in error["message"]

    @pytest.mark.parametrize("ratio", [0.5, 6.0])
    async def test_ratio_outside_prescription_range_rejected(
        self, client, session, make_user, auth_headers, ratio
    ):
        user = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/calc/solve",
            json={"ingredients": [BUTTER], "targets": {"ratio": ratio, "kcal": 400}},
            headers=auth_headers(user),
        )
        assert response.status_code == 422

    async def test_oversized_ingredient_list_rejected(
        self, client, session, make_user, auth_headers
    ):
        """Верхняя граница защищает решатель от произвольно большой задачи."""
        user = await make_user(UserRole.PARENT)
        many = [{**BUTTER, "product_id": f"p{i}"} for i in range(500)]
        response = await client.post(
            "/api/v1/calc/solve",
            json={"ingredients": many, "targets": {"ratio": 4.0, "kcal": 400}},
            headers=auth_headers(user),
        )
        assert response.status_code == 422


class TestScale:
    async def test_scale_doubles_masses(self, client, session, make_user, auth_headers):
        user = await make_user(UserRole.PARENT)
        payload = {
            "ingredients": [BUTTER, CHICKEN],
            "items": [
                {"product_id": "butter", "grams": 30},
                {"product_id": "chicken", "grams": 20},
            ],
        }
        base = await client.post("/api/v1/calc/verify", json=payload, headers=auth_headers(user))
        scaled = await client.post(
            "/api/v1/calc/scale", json={**payload, "factor": 2.0}, headers=auth_headers(user)
        )
        assert scaled.status_code == 200, scaled.text

        base_dish, scaled_dish = base.json()["dish"], scaled.json()["dish"]
        assert scaled_dish["kcal"] == pytest.approx(base_dish["kcal"] * 2)
        # Соотношение инвариантно к масштабу порции
        assert scaled_dish["ratio"] == pytest.approx(base_dish["ratio"])

    async def test_zero_factor_rejected(self, client, session, make_user, auth_headers):
        user = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/calc/scale",
            json={
                "ingredients": [BUTTER],
                "items": [{"product_id": "butter", "grams": 30}],
                "factor": 0,
            },
            headers=auth_headers(user),
        )
        assert response.status_code == 422


class TestChildExclusionsReachTheSolver:
    """Раздел 6.3 ТЗ: исключённые продукты не попадают на вход решателя.

    «Фильтрует вызывающая сторона» — а вызывающей стороны не было: `/calc` не
    знал пациента вовсе, аллергии хранились свободным текстом через запятую и
    ни с чем не сопоставлялись. Ребёнку с аллергией на орехи решатель мог
    предложить арахис, и заметить это можно было только глазами.
    """

    async def _patient_with_exclusion(self, session, make_user, make_patient):
        parent = await make_user(UserRole.PARENT)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

        category = await session.scalar(select(ProductCategory).limit(1))
        if category is None:
            category = ProductCategory(name_ru="Тестовая", sort=0)
            session.add(category)
            await session.flush()

        # Масло, а не орех: тест ниже должен отличать «продукт снят со входа»
        # от «задача и так неразрешима», а для этого исключённый продукт обязан
        # быть единственным источником жира в наборе.
        peanut = Product(
            name_ru=f"Масло арахисовое {uuid.uuid4().hex[:8]}",
            category_id=category.id,
            kcal_100g=884,
            fat_100g=99.9,
            protein_100g=0.0,
            carbs_100g=0.0,
            fiber_100g=0.0,
            source="USDA",
            source_version="SR28",
            verified_at=date(2026, 1, 1),
        )
        session.add(peanut)
        await session.flush()

        patient.allergies = [str(peanut.id), "цитрусовые"]
        await session.flush()
        return parent, patient, peanut

    async def test_solver_never_sees_an_excluded_product(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Проверяется снятие со входа, а не удача решателя.

        Если оставить исключённый продукт в наборе и просто надеяться, что
        решатель его не выберет, — тест пройдёт и с дырой. Поэтому набор
        подобран так, что БЕЗ исключённого продукта задача неразрешима: он
        единственный источник жира. Ответ «неразрешимо» и есть доказательство,
        что на вход он не попал.
        """

        parent, patient, peanut = await self._patient_with_exclusion(
            session, make_user, make_patient
        )

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [
                    CHICKEN,
                    BROCCOLI,
                    {
                        "product_id": str(peanut.id),
                        "kcal": 884,
                        "fat": 99.9,
                        "protein": 0.0,
                        "carbs": 0.0,
                        "fiber": 0.0,
                    },
                ],
                "targets": {"ratio": 4.0, "kcal": 400},
                "patient_id": str(patient.id),
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "infeasible_calculation"

    async def test_excluded_products_are_named_in_the_answer(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Молчаливое исключение не лучше молчаливого включения."""

        parent, patient, peanut = await self._patient_with_exclusion(
            session, make_user, make_patient
        )

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [
                    BUTTER,
                    CHICKEN,
                    BROCCOLI,
                    {
                        "product_id": str(peanut.id),
                        "kcal": 884,
                        "fat": 99.9,
                        "protein": 0.0,
                        "carbs": 0.0,
                        "fiber": 0.0,
                    },
                ],
                "targets": {"ratio": 3.0, "kcal": 400},
                "patient_id": str(patient.id),
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert str(peanut.id) not in {i["product_id"] for i in body["dish"]["items"]}
        assert body["excluded"] == [{"product_id": str(peanut.id), "name_ru": peanut.name_ru}]

    async def test_verify_reports_but_does_not_change_the_composition(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Состав задал человек, и подменять его молча нельзя."""

        parent, patient, peanut = await self._patient_with_exclusion(
            session, make_user, make_patient
        )

        response = await client.post(
            "/api/v1/calc/verify",
            json={
                "ingredients": [
                    BUTTER,
                    {
                        "product_id": str(peanut.id),
                        "kcal": 884,
                        "fat": 99.9,
                        "protein": 0.0,
                        "carbs": 0.0,
                        "fiber": 0.0,
                    },
                ],
                "items": [
                    {"product_id": "butter", "grams": 20},
                    {"product_id": str(peanut.id), "grams": 30},
                ],
                "patient_id": str(patient.id),
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["dish"]["items"]) == 2, "состав остался как есть"
        assert body["excluded"][0]["name_ru"] == peanut.name_ru

    async def test_without_patient_nothing_changes(self, client, session, make_user, auth_headers):
        """Калькулятором пользуются и без выбранного ребёнка."""

        user = await make_user(UserRole.DIETITIAN)
        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [BUTTER, CHICKEN, BROCCOLI],
                "targets": {"ratio": 3.0, "kcal": 400},
            },
            headers=auth_headers(user),
        )
        assert response.status_code == 200, response.text
        assert response.json()["excluded"] == []

    async def test_someone_elses_child_is_forbidden(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Идентификатор пациента в теле запроса — такой же доступ, как в пути."""

        _, patient, _ = await self._patient_with_exclusion(session, make_user, make_patient)
        stranger = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [BUTTER, CHICKEN, BROCCOLI],
                "targets": {"ratio": 3.0, "kcal": 400},
                "patient_id": str(patient.id),
            },
            headers=auth_headers(stranger),
        )
        assert response.status_code == 403

    async def test_all_excluded_is_explained_not_solved(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient, peanut = await self._patient_with_exclusion(
            session, make_user, make_patient
        )

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [
                    {
                        "product_id": str(peanut.id),
                        "kcal": 884,
                        "fat": 99.9,
                        "protein": 0.0,
                        "carbs": 0.0,
                        "fiber": 0.0,
                    }
                ],
                "targets": {"ratio": 3.0, "kcal": 400},
                "patient_id": str(patient.id),
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation_error"
