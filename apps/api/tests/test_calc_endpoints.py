"""`/calc` — тонкие обёртки над keto_engine (раздел 5.3 ТЗ).

Проверяется контракт ручек, а не математика (она покрыта эталонами в
packages/keto_engine): корректность маппинга, наличие engine_version,
человекочитаемая причина при неразрешимости, границы входа.
"""

from __future__ import annotations

import re
import uuid
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import select

from api.schemas import DishIngredientIn
from api.schemas_calc import CALC_GRAMS_MAX
from core.models import FoodStandard, Product, ProductCategory
from core.models.enums import CarbsConvention, FoodDietType, FoodStandardKind, UserRole
from core.repositories import patients as patients_repo
from core.repositories import prescriptions as prescriptions_repo
from keto_engine import ENGINE_VERSION

pytestmark = pytest.mark.asyncio

REPO = Path(__file__).resolve().parents[3]

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

    async def test_items_carry_per_position_contribution(
        self, client, session, make_user, auth_headers
    ):
        """Форму позиции читает строка состава калькулятора кабинета
        (`apps/web` → `features/calculator/DishRows.tsx`) — по вкладу продукта
        видно, что менять, когда блюдо мимо цели. Считать вклад в браузере
        нельзя, поэтому поля обязаны приходить с сервера и сходиться с итогом.
        """
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
        butter, chicken = dish["items"]
        assert set(butter) == {
            "product_id",
            "grams",
            "kcal",
            "fat_g",
            "protein_g",
            "carbs_g",
            "fiber_g",
            "net_carbs_g",
        }
        assert butter["product_id"] == "butter"
        assert butter["grams"] == 50
        assert butter["fat_g"] == pytest.approx(40.55, abs=0.01)
        assert chicken["protein_g"] == pytest.approx(12.4, abs=0.01)
        for field in ("kcal", "fat_g", "protein_g", "carbs_g", "fiber_g"):
            assert butter[field] + chicken[field] == pytest.approx(dish[field], abs=1e-6)

    async def test_ratio_is_computed_on_net_carbs(self, client, session, make_user, auth_headers):
        """Соотношение — по чистым углеводам, лимит — по общим.

        Ответ клиники от 09.09.2026 (вопросы 2, 3 и 6). Форму ответа читают два
        приложения — кабинет (калькулятор и форма рецепта) и калькулятор Mini
        App; бот в `/calc` не ходит вовсе. `net_carbs_g` стоит рядом с
        соотношением не для красоты — без него оно не следует из общих углеводов
        на экране, и проверить его нечем.
        """
        user = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/calc/verify",
            json={
                "ingredients": [BUTTER, BROCCOLI],
                "items": [
                    {"product_id": "butter", "grams": 50},
                    {"product_id": "broccoli", "grams": 100},
                ],
            },
            headers=auth_headers(user),
        )
        assert response.status_code == 200, response.text
        dish = response.json()["dish"]

        # Брокколи: 6.6 г углеводов и 2.6 г клетчатки на 100 г, масло — 0.1 г
        # углеводов на 100 г.
        assert dish["carbs_g"] == pytest.approx(6.65, abs=0.01)
        assert dish["net_carbs_g"] == pytest.approx(4.05, abs=0.01)
        # Жиры 40.95 на (белок 3.25 + чистые 4.05) = 5.61, а по общим углеводам
        # вышло бы 4.14 — разница, ради которой всё и делалось.
        assert dish["ratio"] == pytest.approx(40.95 / 7.30, abs=0.01)

    async def test_targets_no_longer_accept_the_net_carbs_switch(
        self, client, session, make_user, auth_headers
    ):
        """Переключателя нет: клиника назвала правило, а не выбор.

        Схема запрещает лишние поля, поэтому старый клиент получит внятный отказ,
        а не тихо посчитанное не по тому правилу.
        """
        user = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/calc/verify",
            json={
                "ingredients": [BUTTER],
                "items": [{"product_id": "butter", "grams": 50}],
                "targets": {"ratio": 3.0, "kcal": 400, "net_carbs": False},
            },
            headers=auth_headers(user),
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

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
        assert body["ratio_comparable"] is True

    async def test_dish_without_ratio_has_no_ratio_verdict(
        self, client, session, make_user, auth_headers
    ):
        """Цели заданы, а соотношения у блюда нет — вердикт `null`, не `false`.

        Ручку читает Mini App: третье состояние «не определено» (ADR-0038)
        обязано доезжать по контракту, а не схлопываться в «не соответствует».
        Стык проверяется на стороне поставщика.
        """
        user = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/calc/verify",
            json={
                # Чистый жир: ни белка, ни углеводов — знаменатель пуст. У
                # `BUTTER` есть 0,9 г белка, и соотношение у него считается.
                "ingredients": [
                    {
                        "product_id": "oil",
                        "kcal": 884,
                        "fat": 100,
                        "protein": 0,
                        "carbs": 0,
                        "fiber": 0,
                    }
                ],
                "items": [{"product_id": "oil", "grams": 50}],
                "targets": {"ratio": 3.0, "kcal": 430},
            },
            headers=auth_headers(user),
        )
        body = response.json()
        assert body["dish"]["ratio"] is None
        assert body["ratio_within_tolerance"] is None
        assert body["kcal_within_tolerance"] is not None
        # Цели переданы, но сравнивать нечего — это НЕ «мы не спрашивали» (#216).
        assert body["ratio_comparable"] is False

    async def test_without_targets_nothing_is_comparable(
        self, client, session, make_user, auth_headers
    ):
        """Цели не переданы — это третий случай, и он отличим от двух других.

        Прежде `null` значил и «не спрашивали», и «нечего сравнивать»; клиенты
        различали их по наличию цели у себя, то есть по догадке (#216).
        """
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
        body = response.json()
        assert body["ratio_within_tolerance"] is None
        assert body["ratio_comparable"] is False
        assert body["dish"]["ratio"] is not None, "соотношение у блюда есть, цели нет"

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


class TestNonFiniteNumbers:
    """`Infinity` и `NaN` — валидный JSON для разбора, но не масса и не цель.

    Поля с одной нижней границей (`ge=0`) пропускали бесконечность: `inf >= 0`.
    Тела пишутся строкой — `json=` у клиента такие числа не отправит.
    """

    @pytest.mark.parametrize(
        ("url", "body"),
        [
            (
                "/api/v1/calc/verify",
                '{"ingredients": [{"product_id": "butter", "kcal": 717, "fat": Infinity,'
                ' "protein": 0.9, "carbs": 0.1, "fiber": 0}],'
                ' "items": [{"product_id": "butter", "grams": 50}]}',
            ),
            (
                "/api/v1/calc/verify",
                '{"ingredients": [{"product_id": "butter", "kcal": 717, "fat": 81.1,'
                ' "protein": 0.9, "carbs": 0.1, "fiber": 0}],'
                ' "items": [{"product_id": "butter", "grams": Infinity}]}',
            ),
            (
                "/api/v1/calc/solve",
                '{"ingredients": [{"product_id": "butter", "kcal": 717, "fat": 81.1,'
                ' "protein": 0.9, "carbs": 0.1, "fiber": 0}],'
                ' "targets": {"ratio": 3, "kcal": 400, "protein_min_g": Infinity}}',
            ),
            (
                "/api/v1/calc/verify",
                '{"ingredients": [{"product_id": "butter", "kcal": 717, "fat": NaN,'
                ' "protein": 0.9, "carbs": 0.1, "fiber": 0}],'
                ' "items": [{"product_id": "butter", "grams": 50}]}',
            ),
        ],
    )
    async def test_infinity_is_rejected(self, client, make_user, auth_headers, url, body):
        user = await make_user(UserRole.PARENT)

        response = await client.post(
            url,
            content=body,
            headers={**auth_headers(user), "Content-Type": "application/json"},
        )

        assert response.status_code == 422, response.text
        # 422 отдаёт и «недостижимо» (`infeasible_calculation`): отказ обязан быть
        # отказом схемы, иначе бесконечность дошла до решателя.
        assert response.json()["error"]["code"] == "validation_error"


class TestHugeNumbers:
    """Конечное, но огромное число переполняло ядро: 200 с `null` в итогах."""

    @pytest.mark.parametrize(
        ("url", "body"),
        [
            (
                "/api/v1/calc/verify",
                {"ingredients": [BUTTER], "items": [{"product_id": "butter", "grams": 1e308}]},
            ),
            (
                "/api/v1/calc/verify",
                {
                    "ingredients": [{**BUTTER, "kcal": 1e308}],
                    "items": [{"product_id": "butter", "grams": 50}],
                },
            ),
            (
                "/api/v1/calc/verify",
                {
                    "ingredients": [{**BUTTER, "fat": 1e308}],
                    "items": [{"product_id": "butter", "grams": 50}],
                },
            ),
            (
                "/api/v1/calc/verify",
                {
                    "ingredients": [{**BUTTER, "protein": 1e308}],
                    "items": [{"product_id": "butter", "grams": 50}],
                },
            ),
            (
                "/api/v1/calc/verify",
                {
                    "ingredients": [{**BUTTER, "carbs": 1e308}],
                    "items": [{"product_id": "butter", "grams": 50}],
                },
            ),
            (
                "/api/v1/calc/verify",
                {
                    "ingredients": [{**BUTTER, "fiber": 1e308}],
                    "items": [{"product_id": "butter", "grams": 50}],
                },
            ),
            (
                "/api/v1/calc/solve",
                {
                    "ingredients": [BUTTER],
                    "targets": {
                        "ratio": 3,
                        "kcal": 400,
                        "per_ingredient_bounds": {"butter": [-5, None]},
                    },
                },
            ),
        ],
    )
    async def test_out_of_range_is_a_schema_refusal(
        self, client, make_user, auth_headers, url, body
    ):
        user = await make_user(UserRole.PARENT)

        response = await client.post(url, json=body, headers=auth_headers(user))

        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation_error"


class TestGramsLimitMirroredInKit:
    """Предел массы позиции продублирован в ките: экраны проверяют его до запроса.

    Потребители — калькуляторы кабинета (`apps/web/src/features/calculator`) и
    Mini App (`apps/miniapp/src/features/calculator`), оба через
    `packages/ui/src/lib/calcLimits.ts`. Разойдись числа — экран либо пропустит
    массу, на которую сервер ответит общим отказом без слова о поле, либо
    запретит допустимую.
    """

    async def test_kit_constant_equals_schema_bound(self):
        source = (REPO / "packages/ui/src/lib/calcLimits.ts").read_text(encoding="utf-8")
        match = re.search(r"^export const CALC_GRAMS_MAX = (\d+(?:\.\d+)?);$", source, re.MULTILINE)

        assert match is not None, "в ките не нашлось объявления CALC_GRAMS_MAX"
        assert float(match.group(1)) == CALC_GRAMS_MAX

    async def test_custom_dish_has_the_same_bound(self):
        # Своё блюдо сохраняется из того же калькулятора. Предел, которого экран
        # не знает, дал бы форму сохранения для массы, которую сервер отвергнет.
        bound = next(
            (
                float(meta.le)
                for meta in DishIngredientIn.model_fields["grams"].metadata
                if getattr(meta, "le", None) is not None
            ),
            None,
        )

        assert bound is not None, "у граммов своего блюда пропала верхняя граница"
        assert bound == CALC_GRAMS_MAX

    @pytest.mark.parametrize(
        ("grams", "status"), [(CALC_GRAMS_MAX, 200), (CALC_GRAMS_MAX + 0.1, 422)]
    )
    async def test_the_bound_itself_is_accepted(
        self, client, make_user, auth_headers, grams, status
    ):
        # Кит считает сам предел допустимым (`exceedsCalcGrams(5000)` — нет);
        # здесь закреплено, что и сервер проверяет «не больше», а не «меньше».
        user = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/calc/verify",
            json={"ingredients": [BUTTER], "items": [{"product_id": "butter", "grams": grams}]},
            headers=auth_headers(user),
        )

        assert response.status_code == status, response.text


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

    async def test_scaling_beyond_the_grams_limit_is_refused_with_a_reason(
        self, client, make_user, auth_headers
    ):
        """3000 г × 2 — это 6000 г, которые следующая проверка отклонит.

        Отказ на самом пересчёте называет причину и не даёт переписать состав
        массами, с которыми расчёт уже не работает.
        """

        user = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/calc/scale",
            json={
                "ingredients": [BUTTER],
                "items": [{"product_id": "butter", "grams": 3000}],
                "factor": 2.0,
            },
            headers=auth_headers(user),
        )

        assert response.status_code == 422, response.text
        error = response.json()["error"]
        assert error["code"] == "validation_error"
        assert "коэффициент" in error["message"]

    async def test_refusal_just_above_the_limit_does_not_contradict_itself(
        self, client, make_user, auth_headers
    ):
        """2500,001 г × 2 — это 5000,002 г: текст не может говорить «5000 — больше 5000»."""

        user = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/calc/scale",
            json={
                "ingredients": [BUTTER],
                "items": [{"product_id": "butter", "grams": 2500.001}],
                "factor": 2.0,
            },
            headers=auth_headers(user),
        )

        assert response.status_code == 422, response.text
        assert "весила бы 5000,1 г" in response.json()["error"]["message"]

    @pytest.mark.parametrize(
        ("grams", "factor", "shown"),
        [
            (512.2, 15, "7683 г"),
            (1234.568, 100, "123456,8 г"),
            # Превышение в миллиардные доли — всё равно больше 5000, а не «5000».
            (2500.00000000005, 2, "5000,1 г"),
            # Во float больше 5000 на шаг, в Decimal — ровно 5000.
            (196.0015680125441, 25.51, "5000,1 г"),
        ],
    )
    async def test_refusal_amount_has_no_float_noise(
        self, client, make_user, auth_headers, grams, factor, shown
    ):
        """7683.000000000001 — это «7683», а не «7683,1»; и десятые не пропадают
        у больших чисел, как при `:g`."""

        user = await make_user(UserRole.PARENT)

        response = await client.post(
            "/api/v1/calc/scale",
            json={
                "ingredients": [BUTTER],
                "items": [{"product_id": "butter", "grams": grams}],
                "factor": factor,
            },
            headers=auth_headers(user),
        )

        assert response.status_code == 422, response.text
        assert f"весила бы {shown}" in response.json()["error"]["message"]

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

    async def test_exclusion_works_across_standards(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Продукт исключён записью другого стандарта: решатель его тоже не видит.

        Тот же приём, что и выше: без исключённого жира задача неразрешима.
        """

        parent, patient, peanut = await self._patient_with_exclusion(
            session, make_user, make_patient
        )
        standard = FoodStandard(
            name=f"Стандарт {uuid.uuid4().hex[:8]}",
            kind=FoodStandardKind.REFERENCE,
            diet_type=FoodDietType.GENERAL,
            carbs_convention=CarbsConvention.UNKNOWN,
        )
        session.add(standard)
        await session.flush()
        twin = Product(
            standard_id=standard.id,
            food_id=peanut.food_id,
            name_ru=peanut.name_ru,
            category_id=peanut.category_id,
            kcal_100g=peanut.kcal_100g,
            fat_100g=peanut.fat_100g,
            protein_100g=peanut.protein_100g,
            carbs_100g=peanut.carbs_100g,
            fiber_100g=peanut.fiber_100g,
            source=peanut.source,
            source_version=peanut.source_version,
            verified_at=peanut.verified_at,
        )
        session.add(twin)
        await session.flush()
        patient.allergies = [str(twin.id)]
        await session.flush()

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


class TestMealGoal:
    """Reader: the Fact / Goal table of the calculator in `apps/web`."""

    @staticmethod
    def _body(patient_id=None, ratio=4.0, kcal=400):
        return {
            "ingredients": [BUTTER, CHICKEN],
            "items": [
                {"product_id": "butter", "grams": 30},
                {"product_id": "chicken", "grams": 40},
            ],
            "targets": {"ratio": ratio, "kcal": kcal},
            "patient_id": None if patient_id is None else str(patient_id),
        }

    async def _patient_with_prescription(self, session, make_user, make_patient, protein=24.0):
        parent = await make_user(role=UserRole.PARENT)
        doctor = await make_user(role=UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
        await prescriptions_repo.create(
            session,
            patient_id=patient.id,
            ratio=4.0,
            kcal_per_day=1600,
            protein_g=protein,
            carbs_limit_g=20.0,
            meals_per_day=4,
            author_id=doctor.id,
            effective_from=date.today(),
        )
        return parent, patient

    async def test_goal_uses_the_prescription_protein(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await self._patient_with_prescription(session, make_user, make_patient)

        response = await client.post(
            "/api/v1/calc/verify", json=self._body(patient.id), headers=auth_headers(parent)
        )

        assert response.status_code == 200, response.text
        goal = response.json()["meal_goal"]
        assert set(goal) == {"fat_g", "protein_g", "net_carbs_g", "non_fat_g"}
        assert goal["fat_g"] == pytest.approx(40.0)
        assert goal["protein_g"] == pytest.approx(6.0)
        assert goal["net_carbs_g"] == pytest.approx(4.0)
        assert goal["non_fat_g"] == pytest.approx(10.0)

    async def test_without_a_patient_only_the_ratio_part_is_known(
        self, client, make_user, auth_headers
    ):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/verify", json=self._body(), headers=auth_headers(doctor)
        )

        assert response.status_code == 200, response.text
        goal = response.json()["meal_goal"]
        assert goal["fat_g"] == pytest.approx(40.0)
        assert goal["protein_g"] is None
        assert goal["net_carbs_g"] is None

    async def test_no_targets_means_no_goal(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)
        body = self._body()
        del body["targets"]

        response = await client.post("/api/v1/calc/verify", json=body, headers=auth_headers(doctor))

        assert response.status_code == 200, response.text
        assert response.json()["meal_goal"] is None

    async def test_foreign_patient_is_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, patient = await self._patient_with_prescription(session, make_user, make_patient)
        stranger = await make_user(role=UserRole.PARENT)

        response = await client.post(
            "/api/v1/calc/verify", json=self._body(patient.id), headers=auth_headers(stranger)
        )

        assert response.status_code == 403, response.text

    async def test_position_carries_net_carbs(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/verify", json=self._body(), headers=auth_headers(doctor)
        )

        assert response.status_code == 200, response.text
        for item in response.json()["dish"]["items"]:
            assert "net_carbs_g" in item


class TestSolveKeepsChosenProducts:
    """Reader: «Подобрать граммовку» in the web cabinet and the Mini App."""

    WHEY = {
        "product_id": "whey",
        "kcal": 370,
        "fat": 1.0,
        "protein": 90.0,
        "carbs": 0.0,
        "fiber": 0.0,
    }

    async def test_every_product_stays_in_the_solution(self, client, make_user, auth_headers):
        # Without the floor the solver leaves the broccoli out of this set.
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, BROCCOLI],
                "targets": {"ratio": 3.5, "kcal": 300},
            },
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        grams = {item["product_id"]: item["grams"] for item in body["dish"]["items"]}
        assert set(grams) == {"chicken", "butter", "broccoli"}
        assert grams["broccoli"] >= 2
        assert body["ratio_within_tolerance"] is True

    async def test_explicit_bounds_win_over_the_floor(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, BROCCOLI],
                "targets": {
                    "ratio": 3.5,
                    "kcal": 300,
                    "per_ingredient_bounds": {"broccoli": [20, 30]},
                },
            },
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        grams = {item["product_id"]: item["grams"] for item in response.json()["dish"]["items"]}
        assert 20 <= grams["broccoli"] <= 30

    async def test_infeasible_with_every_product_names_what_to_remove(
        self, client, make_user, auth_headers
    ):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, self.WHEY],
                "targets": {"ratio": 4.0, "kcal": 60},
            },
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422, response.text
        error = response.json()["error"]
        assert error["code"] == "infeasible_calculation"
        assert "whey" in error["message"]
        assert "Уберите" in error["message"]
        assert "whey" in error["details"]["product_ids"]

    async def test_reason_uses_the_catalogue_name(self, client, session, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)
        category = await session.scalar(select(ProductCategory).limit(1))
        if category is None:
            category = ProductCategory(name_ru="Тестовая", sort=0)
            session.add(category)
            await session.flush()
        name = f"Изолят {uuid.uuid4().hex[:8]}"
        product = Product(
            name_ru=name,
            category_id=category.id,
            kcal_100g=370,
            fat_100g=1.0,
            protein_100g=90.0,
            carbs_100g=0.0,
            fiber_100g=0.0,
            source="USDA",
            source_version="SR28",
            verified_at=date(2026, 1, 1),
        )
        session.add(product)
        await session.flush()

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, {**self.WHEY, "product_id": str(product.id)}],
                "targets": {"ratio": 4.0, "kcal": 60},
            },
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422, response.text
        assert name in response.json()["error"]["message"]
        assert str(product.id) not in response.json()["error"]["message"]

    async def test_goal_impossible_for_any_set_keeps_the_engine_reason(
        self, client, make_user, auth_headers
    ):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={"ingredients": [CHICKEN, BROCCOLI], "targets": {"ratio": 4.0, "kcal": 400}},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422, response.text
        assert "Уберите" not in response.json()["error"]["message"]


class TestSolvePinnedMass:
    """Reader: the pin button in the web cabinet's calculator."""

    async def test_pinned_mass_is_returned_unchanged(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, BROCCOLI],
                "targets": {
                    "ratio": 3.5,
                    "kcal": 300,
                    "per_ingredient_bounds": {"broccoli": [25, 25]},
                },
            },
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        grams = {item["product_id"]: item["grams"] for item in body["dish"]["items"]}
        assert grams["broccoli"] == pytest.approx(25, abs=0.05)
        assert body["ratio_within_tolerance"] is True

    async def test_pin_below_the_minimum_is_refused_by_name(self, client, make_user, auth_headers):
        # The solver would leave such a product out of the dish without a word.
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, BROCCOLI],
                "targets": {
                    "ratio": 3.5,
                    "kcal": 300,
                    "per_ingredient_bounds": {"broccoli": [1, 1]},
                },
            },
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422, response.text
        error = response.json()["error"]
        assert error["code"] == "validation_error"
        assert "broccoli" in error["message"]
        assert error["details"]["product_ids"] == ["broccoli"]

    async def test_fractional_pin_is_refused_by_name(self, client, make_user, auth_headers):
        # The solver returns whole grams, so 20.5 would come back as 20.
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, BROCCOLI],
                "targets": {
                    "ratio": 3.5,
                    "kcal": 300,
                    "per_ingredient_bounds": {"broccoli": [20.5, 20.5]},
                },
            },
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"]["product_ids"] == ["broccoli"]

    async def test_pin_that_makes_the_goal_unreachable_says_so(
        self, client, make_user, auth_headers
    ):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, BROCCOLI],
                "targets": {
                    "ratio": 3.5,
                    "kcal": 300,
                    "per_ingredient_bounds": {"chicken": [500, 500]},
                },
            },
            headers=auth_headers(doctor),
        )

        assert response.json()["error"]["code"] == "infeasible_calculation", response.text


class TestPrescriptionGoal:
    """Reader: the gram preview in the web cabinet's prescription form."""

    BODY = {"ratio": 4, "kcal_per_day": 1200, "protein_g": 24, "meals_per_day": 4}

    async def test_day_and_equal_meal(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/prescription-goal", json=self.BODY, headers=auth_headers(doctor)
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["engine_version"] == ENGINE_VERSION
        assert body["day"]["non_fat_g"] == pytest.approx(1200 / 40)
        assert body["day"]["fat_g"] == pytest.approx(120)
        assert body["day"]["protein_g"] == pytest.approx(24)
        assert body["day"]["net_carbs_g"] == pytest.approx(6)
        assert body["meal"]["fat_g"] == pytest.approx(30)
        assert body["meal"]["protein_g"] == pytest.approx(6)
        assert body["meal"]["net_carbs_g"] == pytest.approx(1.5)
        assert body["dietary_unit_kcal"] == pytest.approx(40)

    async def test_day_without_meals(self, client, make_user, auth_headers):
        """The carb limit is derived from the day; the doctor may not have typed
        the number of meals yet (dietitian's report of 2026-11-12)."""

        doctor = await make_user(role=UserRole.DOCTOR)
        body = {"ratio": 3, "kcal_per_day": 1564, "protein_g": 23}

        response = await client.post(
            "/api/v1/calc/prescription-goal", json=body, headers=auth_headers(doctor)
        )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["meal"] is None
        assert data["dietary_unit_kcal"] == pytest.approx(31)
        assert data["day"]["non_fat_g"] == pytest.approx(1564 / 31)
        assert data["day"]["net_carbs_g"] == pytest.approx(1564 / 31 - 23)

    async def test_protein_that_does_not_fit_has_no_split(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/prescription-goal",
            json={**self.BODY, "protein_g": 31},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        assert response.json()["day"]["protein_g"] is None
        assert response.json()["meal"]["net_carbs_g"] is None

    async def test_requires_login(self, client):
        response = await client.post("/api/v1/calc/prescription-goal", json=self.BODY)

        assert response.status_code == 401

    async def test_rejects_zero_meals(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/prescription-goal",
            json={**self.BODY, "meals_per_day": 0},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422


class TestSolveNearCurrentGrams:
    """Reader: «Подобрать граммовку» in the web cabinet's calculator."""

    async def test_vegetable_is_not_pushed_to_the_minimum(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, BROCCOLI],
                "targets": {"ratio": 3.5, "kcal": 300},
                "current_grams": {"chicken": 25, "butter": 33, "broccoli": 40},
            },
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        body = response.json()
        grams = {item["product_id"]: item["grams"] for item in body["dish"]["items"]}
        assert grams["broccoli"] >= 15
        assert body["reshaped"] is False
        assert body["ratio_within_tolerance"] is True
        assert body["kcal_within_tolerance"] is True

    async def test_unreachable_corridor_falls_back_and_says_so(
        self, client, make_user, auth_headers
    ):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, BROCCOLI],
                "targets": {"ratio": 3.5, "kcal": 300},
                "current_grams": {"chicken": 200, "butter": 2, "broccoli": 100},
            },
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        assert response.json()["reshaped"] is True

    async def test_pin_stays_inside_the_corridor_search(self, client, make_user, auth_headers):
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={
                "ingredients": [CHICKEN, BUTTER, BROCCOLI],
                "targets": {
                    "ratio": 3.5,
                    "kcal": 300,
                    "per_ingredient_bounds": {"broccoli": [30, 30]},
                },
                "current_grams": {"chicken": 25, "butter": 33, "broccoli": 30},
            },
            headers=auth_headers(doctor),
        )

        grams = {item["product_id"]: item["grams"] for item in response.json()["dish"]["items"]}
        assert grams["broccoli"] == pytest.approx(30, abs=0.05)

    async def test_without_masses_nothing_changes(self, client, make_user, auth_headers):
        # Reader: the Mini App, which does not send masses yet.
        doctor = await make_user(role=UserRole.DOCTOR)

        response = await client.post(
            "/api/v1/calc/solve",
            json={"ingredients": [CHICKEN, BUTTER], "targets": {"ratio": 3.5, "kcal": 300}},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        assert response.json()["reshaped"] is False
