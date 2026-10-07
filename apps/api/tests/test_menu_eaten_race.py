"""Сохранение дня и отметка «съедено» в одну и ту же секунду (Н10).

Проверка «новый состав не стирает съеденное» (ADR-0047) читала позиции без
блокировки, а отметка «съедено» не трогала строку дня, которую держит
сохранение. Специалист сохранял день без позиции, семья в ту же секунду её
отмечала — и отметка уходила вместе с позицией молча, мимо отказа 409.

Видно это только на настоящих транзакциях: общая фикстура API отдаёт приложению
ту же сессию, что и тесту, и двух одновременных транзакций на ней не бывает.
Поэтому здесь приложение ходит в базу своими сессиями (как в
`test_assistant_idempotency_real_session.py`), а записанное убирается в
`finally`. Окно гонки открывается намеренно: сохранение дня задерживается между
проверкой и заменой позиций, и отметка уходит ровно в это окно.

Потребители отказа — `apps/web` (`useUpsertMenuMutation`, `useEatenMutation`) и
`apps/miniapp` (`useSaveMenu`, `useMarkEaten`): по 409 они перечитывают день; `apps/bot`
(`meal_mark`) по 409 показывает план, какой он теперь.
"""

from __future__ import annotations

import asyncio
import itertools
import uuid
from collections.abc import AsyncIterator
from datetime import date
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from api.main import create_app
from api.security import create_token
from core.db import get_engine, get_sessionmaker
from core.models import (
    AuditLog,
    CustomDish,
    Menu,
    MenuItem,
    ParentPatient,
    Patient,
    Product,
    ProductCategory,
    User,
)
from core.models.enums import Sex, UserRole
from core.repositories import menus as menus_repo
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo

pytestmark = pytest.mark.asyncio

DAY = "2026-03-03"

_host_seq = itertools.count(1)


def _headers(user_id: uuid.UUID) -> dict[str, str]:
    token = create_token(user_id=user_id, role=UserRole.PARENT, token_type="access")
    return {"Authorization": f"Bearer {token}"}


async def _app_client() -> AsyncClient:
    number = next(_host_seq)
    transport = ASGITransport(
        app=create_app(), client=(f"10.2.{number // 256 % 256}.{number % 256}", 12345)
    )
    return AsyncClient(transport=transport, base_url="http://test")


class TestEatenMarkDuringDaySave:
    @pytest_asyncio.fixture(autouse=True)
    async def _fresh_engine(self) -> AsyncIterator[None]:
        """Движок приложения кэширован на процесс, а цикл событий у теста свой."""

        get_engine.cache_clear()
        get_sessionmaker.cache_clear()
        yield
        await get_engine().dispose()
        get_engine.cache_clear()
        get_sessionmaker.cache_clear()

    @pytest_asyncio.fixture
    async def family(self, _fresh_engine: None) -> AsyncIterator[dict[str, Any]]:
        """Родитель, ребёнок и два своих блюда — закоммиченные."""

        created_category: uuid.UUID | None = None
        async with get_sessionmaker()() as session:
            parent = await users_repo.create(
                session,
                role=UserRole.PARENT,
                full_name="Родитель гонки меню",
                email=f"menu-race-{uuid.uuid4().hex[:10]}@example.com",
                password_hash="x",
            )
            patient = await patients_repo.create(
                session, full_name="Ребёнок гонки меню", birth_date=date(2018, 5, 1), sex=Sex.F
            )
            await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)

            category = await session.scalar(select(ProductCategory).limit(1))
            if category is None:
                category = ProductCategory(name_ru="Тестовая гонки меню", sort=0)
                session.add(category)
                await session.flush()
                created_category = category.id
            product = Product(
                name_ru=f"Масло гонки {uuid.uuid4().hex[:8]}",
                category_id=category.id,
                source="USDA",
                source_version="SR28",
                verified_at=date(2026, 1, 1),
                kcal_100g=717,
                fat_100g=81.1,
                protein_100g=0.9,
                carbs_100g=0.1,
                fiber_100g=0.0,
            )
            session.add(product)
            await session.flush()
            dishes = []
            for title in ("Завтрак гонки", "Обед гонки"):
                dish = CustomDish(
                    patient_id=patient.id,
                    title=title,
                    ingredients=[{"product_id": str(product.id), "grams": 10}],
                )
                session.add(dish)
                dishes.append(dish)
            await session.flush()
            await session.commit()
            ids = {
                "parent": parent.id,
                "patient": patient.id,
                "product": product.id,
                "breakfast": dishes[0].id,
                "lunch": dishes[1].id,
            }

        try:
            yield ids
        finally:
            async with get_sessionmaker()() as session:
                await session.execute(delete(MenuItem).where(MenuItem.patient_id == ids["patient"]))
                await session.execute(delete(Menu).where(Menu.patient_id == ids["patient"]))
                await session.execute(
                    delete(CustomDish).where(CustomDish.patient_id == ids["patient"])
                )
                await session.execute(
                    delete(ParentPatient).where(ParentPatient.patient_id == ids["patient"])
                )
                await session.execute(delete(AuditLog).where(AuditLog.user_id == ids["parent"]))
                await session.execute(delete(Product).where(Product.id == ids["product"]))
                if created_category is not None:
                    await session.execute(
                        delete(ProductCategory).where(ProductCategory.id == created_category)
                    )
                await session.execute(delete(Patient).where(Patient.id == ids["patient"]))
                await session.execute(delete(User).where(User.id == ids["parent"]))
                await session.commit()

    async def test_mark_in_the_window_of_a_save_is_not_lost_silently(
        self, family: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        headers = _headers(family["parent"])
        url = f"/api/v1/patients/{family['patient']}/menus"
        breakfast = {"meal_index": 1, "custom_dish_id": str(family["breakfast"])}
        lunch = {"meal_index": 2, "custom_dish_id": str(family["lunch"])}

        async with await _app_client() as http:
            day = await http.put(
                url, json={"date": DAY, "items": [breakfast, lunch]}, headers=headers
            )
            assert day.status_code == 200, day.text
            lunch_id = next(
                item["id"]
                for item in day.json()["items"]
                if item["custom_dish_id"] == str(family["lunch"])
            )

            # Окно гонки: сохранение уже прошло проверку «съеденное не стирается»
            # и ещё не заменило позиции. Отметка уходит ровно сюда.
            checked = asyncio.Event()
            original = menus_repo.replace_items

            async def slow_replace(*args: Any, **kwargs: Any) -> Any:
                checked.set()
                await asyncio.sleep(0.5)
                return await original(*args, **kwargs)

            monkeypatch.setattr(menus_repo, "replace_items", slow_replace)

            async def mark() -> Any:
                await checked.wait()
                return await http.post(
                    f"{url}/items/{lunch_id}/eaten", json={"eaten": True}, headers=headers
                )

            # Новый день — без обеда: тот, кто сохраняет, обеда съеденным не видел.
            save, marked = await asyncio.gather(
                http.put(url, json={"date": DAY, "items": [breakfast]}, headers=headers),
                mark(),
            )

        assert save.status_code == 200, save.text
        # Отметка дождалась сохранения и узнала, что позиции больше нет, — а не
        # легла на позицию, которую сохранение тут же убрало.
        assert marked.status_code == 409, marked.text
        assert marked.json()["error"]["details"] == {"reason": "plan_changed"}

        async with get_sessionmaker()() as session:
            lost = await session.scalar(
                select(MenuItem).where(
                    MenuItem.id == uuid.UUID(lunch_id),
                    MenuItem.eaten.is_(True),
                    MenuItem.deleted_at.is_not(None),
                )
            )
        assert lost is None, "отметка «съедено» ушла вместе с удалённой позицией"

    async def test_save_after_a_mark_is_refused_not_applied(self, family: dict[str, Any]) -> None:
        """Обратный порядок: отметка успела раньше — сохранение без этой позиции
        получает 409 и ничего не меняет. Это прежнее поведение, держится оно
        теперь не на удаче, а на той же блокировке."""

        headers = _headers(family["parent"])
        url = f"/api/v1/patients/{family['patient']}/menus"
        breakfast = {"meal_index": 1, "custom_dish_id": str(family["breakfast"])}
        lunch = {"meal_index": 2, "custom_dish_id": str(family["lunch"])}

        async with await _app_client() as http:
            day = await http.put(
                url, json={"date": DAY, "items": [breakfast, lunch]}, headers=headers
            )
            lunch_id = next(
                item["id"]
                for item in day.json()["items"]
                if item["custom_dish_id"] == str(family["lunch"])
            )
            marked = await http.post(
                f"{url}/items/{lunch_id}/eaten", json={"eaten": True}, headers=headers
            )
            assert marked.status_code == 200, marked.text

            save = await http.put(url, json={"date": DAY, "items": [breakfast]}, headers=headers)
            # Переставленный порядок приёмов при той же позиции отметку хранит.
            kept = await http.put(
                url,
                json={"date": DAY, "items": [lunch, {**breakfast, "portion_factor": 0.5}]},
                headers=headers,
            )

        assert save.status_code == 409
        assert save.json()["error"]["details"]["reason"] == "drops_eaten_items"
        assert kept.status_code == 200, kept.text
        eaten = {item["id"]: item["eaten"] for item in kept.json()["items"]}
        assert eaten[lunch_id] is True, "совпавшая по ключу позиция отметку не теряет"
