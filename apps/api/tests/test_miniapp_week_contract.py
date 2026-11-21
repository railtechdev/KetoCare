"""Неделя, визит, телефон клиники и схема препаратов в Mini App — стык на стороне поставщика.

Потребители — этап 4 аудита Mini App (21.11.2026, решения Р3 и Р4):

- полоса дней и «Что купить» (`apps/miniapp/src/features/menu/useMenu.ts`,
  `useMenuWeek`; `ShoppingScreen.tsx` складывает граммы `shoppingList` кита)
  читают `GET …/menus/week` с началом во вчерашнем дне — не в понедельник;
- строка «Ближайший визит к врачу» на «Сегодня» (`features/today/TodayScreen.tsx`,
  `NextVisitLine`) читает `next_control` сводки — семье без назначения точки;
- «Связь с клиникой» (`features/clinic/useClinicPhone.ts`) читает
  `text.family_phone` бланка клиники;
- «Схема препаратов» (`features/medications/MedicationScheme.tsx`) читает
  весь список препаратов без `active_on` и отбирает отменённые сама —
  правилом кита `scheduledMedications`, общим с листом кабинета.

Тесты экранов работают с подделками ответов, поэтому здесь каждая ручка
вызывается сессией Mini App — открытой подписью Telegram — и проверяется то,
что читает экран.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from api.services.overview import FAMILY_MISSED_VISIT_DAYS
from core.clock import local_today
from core.models import Medication
from core.models.enums import UserRole
from core.repositories import patients as patients_repo

from .test_letterhead import TEXT as LETTERHEAD
from .test_menus import BUTTER, _custom_dish, _product
from .test_miniapp_auth import _linked_family, bot_token, init_data  # noqa: F401

pytestmark = pytest.mark.asyncio


async def _open_miniapp(client, session, make_user, make_patient):
    parent, patient, _ = await _linked_family(session, make_user, make_patient)
    opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})
    assert opened.status_code == 200, opened.text
    headers = {"Authorization": f"Bearer {opened.json()['access_token']}"}
    return parent, patient, headers


class TestWeekForTheDayStrip:
    async def test_week_from_yesterday_carries_grams_per_position(
        self, client, session, make_user, make_patient
    ):
        _, patient, headers = await _open_miniapp(client, session, make_user, make_patient)
        butter = await _product(session, "Масло", **BUTTER)
        salt = await _product(session, "Соль", **BUTTER)
        salt.counts_in_calculation = False
        await session.flush()
        dish = await _custom_dish(session, patient, ingredients=[(butter, 40), (salt, 1)])
        yesterday = local_today() - timedelta(days=1)
        planned = local_today() + timedelta(days=3)
        saved = await client.put(
            f"/api/v1/patients/{patient.id}/menus",
            json={
                "date": planned.isoformat(),
                # Полпорции: граммы в неделе — уже на позицию, экран не умножает.
                "items": [{"meal_index": 1, "custom_dish_id": str(dish.id), "portion_factor": 0.5}],
            },
            headers=headers,
        )
        assert saved.status_code == 200, saved.text

        response = await client.get(
            f"/api/v1/patients/{patient.id}/menus/week",
            params={"start": yesterday.isoformat()},
            headers=headers,
        )

        assert response.status_code == 200, response.text
        days = response.json()["days"]
        # Начало — любой день, не только понедельник: полоса начинается вчера.
        assert [day["date"] for day in days] == [
            (yesterday + timedelta(days=offset)).isoformat() for offset in range(7)
        ]
        by_date = {day["date"]: day["menu"] for day in days}
        # Пустой день — `null`: точки на полосе у него нет.
        assert by_date[local_today().isoformat()] is None
        [item] = by_date[planned.isoformat()]["items"]
        rows = {row["product_id"]: row for row in item["ingredients"]}
        assert rows[str(butter.id)]["grams"] == 20
        assert rows[str(butter.id)]["name_ru"] == butter.name_ru
        assert rows[str(butter.id)]["counts_in_calculation"] is True
        # Приправа — «по вкусу», без граммов в списке покупок.
        assert rows[str(salt.id)]["counts_in_calculation"] is False

    async def test_another_childs_week_stays_closed(self, client, session, make_user, make_patient):
        _, _, headers = await _open_miniapp(client, session, make_user, make_patient)
        stranger = await make_patient()

        response = await client.get(
            f"/api/v1/patients/{stranger.id}/menus/week",
            params={"start": local_today().isoformat()},
            headers=headers,
        )
        assert response.status_code == 403


class TestNextVisitOnToday:
    async def test_family_reads_the_date_without_the_purpose(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, patient, headers = await _open_miniapp(client, session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        planned = local_today() + timedelta(days=20)
        created = await client.post(
            f"/api/v1/patients/{patient.id}/control-visits",
            json={"planned_on": planned.isoformat(), "note": "после ЭЭГ"},
            headers=auth_headers(doctor),
        )
        assert created.status_code == 201, created.text

        response = await client.get(f"/api/v1/patients/{patient.id}/overview", headers=headers)

        assert response.status_code == 200, response.text
        visit = response.json()["next_control"]
        assert visit["planned_on"] == planned.isoformat()
        assert visit["overdue"] is False
        # Зачем визит — говорит врач (ADR-0050); записку врача семья не читает.
        assert visit["purpose"] is None
        assert "после ЭЭГ" not in response.text
        # Перечня анализов в сводке нет: его срок клиника не назвала.
        assert "labs" not in visit

    async def test_family_skips_old_unmarked_points(
        self, client, session, make_user, make_patient, auth_headers
    ):
        # График строят и задним числом — от даты начала терапии до
        # приложения, и прошедшие точки встают неотмеченными. «Визит был
        # назначен на 1 июля» про визит до приложения — ложная тревога, за
        # которой семья не видит настоящего следующего. Специалист видит всё.
        _, patient, headers = await _open_miniapp(client, session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        base = f"/api/v1/patients/{patient.id}"
        today = local_today()
        old = today - timedelta(days=FAMILY_MISSED_VISIT_DAYS + 1)
        recent = today - timedelta(days=FAMILY_MISSED_VISIT_DAYS)
        future = today + timedelta(days=20)
        for planned in (old, future):
            created = await client.post(
                f"{base}/control-visits",
                json={"planned_on": planned.isoformat()},
                headers=auth_headers(doctor),
            )
            assert created.status_code == 201, created.text

        family = (await client.get(f"{base}/overview", headers=headers)).json()
        care = (await client.get(f"{base}/overview", headers=auth_headers(doctor))).json()

        assert family["next_control"]["planned_on"] == future.isoformat()
        assert family["next_control"]["overdue"] is False
        assert care["next_control"]["planned_on"] == old.isoformat()
        assert care["next_control"]["overdue"] is True

        # Пропущенный недавно — семье по-прежнему назван: ей есть что сделать.
        created = await client.post(
            f"{base}/control-visits",
            json={"planned_on": recent.isoformat()},
            headers=auth_headers(doctor),
        )
        assert created.status_code == 201, created.text
        family = (await client.get(f"{base}/overview", headers=headers)).json()
        assert family["next_control"]["planned_on"] == recent.isoformat()
        assert family["next_control"]["overdue"] is True

    async def test_full_schedule_stays_with_the_care_team(
        self, client, session, make_user, make_patient
    ):
        _, patient, headers = await _open_miniapp(client, session, make_user, make_patient)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/control-schedule", headers=headers
        )
        assert response.status_code == 403


class TestClinicPhone:
    async def test_family_reads_the_phone_from_the_letterhead(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, _, headers = await _open_miniapp(client, session, make_user, make_patient)
        admin = await make_user(UserRole.ADMIN)
        saved = await client.put(
            "/api/v1/admin/letterhead",
            json={**LETTERHEAD, "family_phone": "+998 71 000-00-00"},
            headers=auth_headers(admin),
        )
        assert saved.status_code == 200, saved.text

        response = await client.get("/api/v1/letterhead", headers=headers)

        assert response.status_code == 200, response.text
        assert response.json()["text"]["family_phone"] == "+998 71 000-00-00"


class TestMedicationScheme:
    async def test_whole_list_with_term_fields(self, client, session, make_user, make_patient):
        _, patient, headers = await _open_miniapp(client, session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        today = local_today()
        for name, started, stopped in (
            ("Депакин", date(2026, 1, 1), None),
            ("Кеппра", today + timedelta(days=5), today + timedelta(days=40)),
            ("Фризиум", date(2026, 1, 1), today - timedelta(days=1)),
        ):
            session.add(
                Medication(
                    patient_id=patient.id,
                    drug_name=name,
                    dose="200 мг",
                    frequency="утром и на ночь",
                    started_at=started,
                    stopped_at=stopped,
                    author_id=doctor.id,
                )
            )
        await session.flush()

        response = await client.get(
            f"/api/v1/patients/{patient.id}/medications",
            params={"limit": 200, "offset": 0},
            headers=headers,
        )

        assert response.status_code == 200, response.text
        items = {item["drug_name"]: item for item in response.json()["items"]}
        # Будущий препарат — в схеме; отменённый сервер тоже отдаёт, и экран
        # отбирает его сам правилом кита (`stopped_at` раньше сегодня).
        assert set(items) == {"Депакин", "Кеппра", "Фризиум"}
        for item in items.values():
            assert {
                "id",
                "drug_name",
                "dose",
                "frequency_code",
                "frequency",
                "started_at",
                "stopped_at",
            } <= set(item)
        assert items["Кеппра"]["started_at"] == (today + timedelta(days=5)).isoformat()
        assert items["Депакин"]["stopped_at"] is None
