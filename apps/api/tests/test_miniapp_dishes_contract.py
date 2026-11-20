"""Блюда ребёнка и фото рецепта из Mini App — стык на стороне поставщика.

Потребители — вкладка «Блюда» Mini App (аудит Mini App 21.11.2026, этап 3):
карточка блюда ребёнка (`apps/miniapp/src/features/dishes/ChildDishes.tsx`:
показатели, «Что взвесить», «Как готовить», «Удалить блюдо»), загрузка его
состава в расчёт (`features/calculator/useCalculator.ts`, `useSeedRows`) и
фото в карточке рецепта (`features/recipes/useRecipes.ts`, `useRecipePhoto`).
Их тесты работают с подделками ответов, поэтому здесь каждая ручка
вызывается сессией Mini App — открытой подписью Telegram — и проверяется то,
что читает экран.

Фото Mini App берёт клиентом API с токеном в заголовке, а не `<img src>`:
куки у неё нет (раздел 5.2 ТЗ). Поэтому важно, что ручка фото отвечает на
заголовок `Authorization` так же, как на куку кабинета.
"""

from __future__ import annotations

import pytest

from core.models.enums import UserRole

from . import test_attachments as attachments
from .test_attachments import PNG, upload
from .test_menu_dish_usage import _dish, _product
from .test_miniapp_auth import _linked_family, bot_token, init_data  # noqa: F401

pytestmark = pytest.mark.asyncio


async def _open_miniapp(client, session, make_user, make_patient):
    parent, patient, _ = await _linked_family(session, make_user, make_patient)
    opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})
    assert opened.status_code == 200, opened.text
    headers = {"Authorization": f"Bearer {opened.json()['access_token']}"}
    return parent, patient, headers


class TestChildDishCard:
    async def test_card_reads_composition_numbers_and_steps(
        self, client, session, make_user, make_patient
    ):
        _, patient, headers = await _open_miniapp(client, session, make_user, make_patient)
        product = await _product(session)
        # Приправа (ADR-0054): карточка помечает её «не учитывается» по
        # `computed.uncounted_product_ids`.
        pepper = await _product(session)
        pepper.counts_in_calculation = False
        await session.flush()
        created = await client.post(
            f"/api/v1/patients/{patient.id}/custom-dishes",
            json={
                "title": "Завтрак",
                "ingredients": [
                    {"product_id": str(product.id), "grams": 52.5},
                    {"product_id": str(pepper.id), "grams": 1},
                ],
                "instructions": "Взбить.",
            },
            headers=headers,
        )
        assert created.status_code == 201, created.text

        response = await client.get(
            f"/api/v1/patients/{patient.id}/custom-dishes",
            params={"limit": 100, "offset": 0},
            headers=headers,
        )

        assert response.status_code == 200, response.text
        [item] = response.json()["items"]
        assert item["title"] == "Завтрак"
        # Карточка печатает граммы как пришли — своей арифметики у неё нет.
        assert item["ingredients"] == [
            {"product_id": str(product.id), "grams": 52.5},
            {"product_id": str(pepper.id), "grams": 1},
        ]
        assert item["instructions"] == "Взбить."
        # Показатели на всё блюдо — те, что печатает карточка; приправа в них
        # не входит и названа отдельно.
        computed = item["computed"]
        # Калорийность ядро считает по 9/4/4 от макронутриентов (52,5 г масла).
        assert computed["kcal"] == pytest.approx(385.3, abs=0.1)
        assert computed["fat"] == pytest.approx(81.1 * 0.525, abs=0.01)
        assert computed["protein"] == pytest.approx(0.9 * 0.525, abs=0.01)
        assert computed["carbs"] == pytest.approx(0.1 * 0.525, abs=0.01)
        assert computed["ratio"] is not None
        assert computed["uncounted_product_ids"] == [str(pepper.id)]

        # Состав в расчёт встаёт по карточкам продуктов.
        detail = await client.get(f"/api/v1/products/{product.id}", headers=headers)
        assert detail.status_code == 200, detail.text
        assert {
            "id",
            "name_ru",
            "kcal_100g",
            "fat_100g",
            "protein_100g",
            "carbs_100g",
            "fiber_100g",
            "is_active",
        } <= detail.json().keys()

    async def test_family_deletes_its_dish_and_the_list_forgets_it(
        self, client, session, make_user, make_patient
    ):
        _, patient, headers = await _open_miniapp(client, session, make_user, make_patient)
        dish = await _dish(session, patient, await _product(session))

        deleted = await client.delete(
            f"/api/v1/patients/{patient.id}/custom-dishes/{dish.id}", headers=headers
        )

        assert deleted.status_code == 204, deleted.text
        listed = await client.get(f"/api/v1/patients/{patient.id}/custom-dishes", headers=headers)
        assert listed.json()["items"] == []


class TestRecipePhotoInMiniApp:
    async def test_photo_comes_to_the_header_token(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, _, headers = await _open_miniapp(client, session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        recipe_id = await attachments.TestRecipePhoto()._recipe(
            client, session, dietitian, auth_headers
        )
        uploaded = await client.put(
            f"/api/v1/recipes/{recipe_id}/photo",
            files=upload(PNG),
            headers=auth_headers(dietitian),
        )
        assert uploaded.status_code == 200, uploaded.text
        published = await client.post(
            f"/api/v1/recipes/{recipe_id}/publish", headers=auth_headers(dietitian)
        )
        assert published.status_code == 200, published.text

        # Карточка знает о фото по `photo_path` рецепта.
        recipe = await client.get(f"/api/v1/recipes/{recipe_id}", headers=headers)
        assert recipe.json()["photo_path"] is not None

        got = await client.get(f"/api/v1/recipes/{recipe_id}/photo", headers=headers)
        assert got.status_code == 200
        assert got.headers["content-type"].startswith("image/")
        assert got.content == PNG

    async def test_no_photo_is_not_found_and_the_card_shows_nothing(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, _, headers = await _open_miniapp(client, session, make_user, make_patient)
        dietitian = await make_user(UserRole.DIETITIAN)
        recipe_id = await attachments.TestRecipePhoto()._recipe(
            client, session, dietitian, auth_headers
        )
        await client.post(f"/api/v1/recipes/{recipe_id}/publish", headers=auth_headers(dietitian))

        got = await client.get(f"/api/v1/recipes/{recipe_id}/photo", headers=headers)

        assert got.status_code == 404
        assert got.json()["error"]["code"] == "not_found"
