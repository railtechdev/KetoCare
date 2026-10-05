"""Дневник и напоминания из Mini App — стык на стороне поставщика (ADR-0044).

Потребители — вкладка «Дневник» (`apps/miniapp/src/features/diary`) и блок
«Напоминания» на главной (`apps/miniapp/src/features/reminders`). Их тесты
работают с подделками ответов, а подделка повторяет представление автора о
контракте, а не сам контракт. Поэтому здесь каждая ручка, которую они
вызывают, вызывается сессией Mini App — открытой подписью Telegram, сужённой
до ребёнка из привязки, — и проверяется форма, которую читает экран.

Ограничения маршрутов у канала `miniapp` нет по построению (`deps/auth.py`),
и именно поэтому оно проверяется тестом: появись оно однажды, семья из
Telegram снова осталась бы без собственных записей.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from core.models import IntakeOption, Medication, SeizureType
from core.models.enums import IntakeScale, UserRole

from .test_miniapp_auth import _linked_family, bot_token, init_data  # noqa: F401

pytestmark = pytest.mark.asyncio

#: Поля, которые читает лента записей Mini App, — общие для всех шести видов.
COMMON = {"id", "occurred_at", "source", "created_by"}

#: Сверх общих — то, что экран печатает и что правит форма «Исправить».
FIELDS_BY_KIND = {
    "seizures": {
        "seizure_type_id",
        "duration_sec",
        "duration_option_id",
        "count",
        "description",
        "triggers",
    },
    "ketones": {"value", "method"},
    "weight": {"weight_kg", "height_cm"},
    "medications": {"medication_id", "taken"},
    "meals": {"menu_item_id", "free_text"},
    "side-effects": {"symptom", "description"},
}


async def _open_miniapp(client, session, make_user, make_patient):
    parent, patient, _ = await _linked_family(session, make_user, make_patient)
    opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})
    assert opened.status_code == 200, opened.text
    headers = {"Authorization": f"Bearer {opened.json()['access_token']}"}
    return parent, patient, headers


async def _seizure_type(session) -> SeizureType:
    found = await session.scalar(select(SeizureType).order_by(SeizureType.sort).limit(1))
    if found is None:
        found = SeizureType(name_ru="Тонико-клонический", sort=0)
        session.add(found)
        await session.flush()
    return found


async def _duration_option(session) -> IntakeOption:
    option = IntakeOption(
        scale=IntakeScale.SEIZURE_DURATION,
        code=f"code-{uuid.uuid4().hex[:8]}",
        name_ru="От 1 до 5 минут",
        sort=1,
    )
    session.add(option)
    await session.flush()
    return option


async def _medication(session, *, patient, author) -> Medication:
    doctor = author
    medication = Medication(
        patient_id=patient.id,
        drug_name="Депакин",
        dose="200 мг",
        frequency="2 раза в день",
        started_at=date(2026, 1, 1),
        author_id=doctor.id,
    )
    session.add(medication)
    await session.flush()
    return medication


async def _create_body(session, kind: str, *, patient, make_user) -> dict:
    """Запись, какой её оставляет бот: момент — час назад."""

    base = {"occurred_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat()}
    match kind:
        case "seizures":
            seizure_type = await _seizure_type(session)
            option = await _duration_option(session)
            # Интервал со слов, как пишет бот (ADR-0020).
            return base | {
                "seizure_type_id": str(seizure_type.id),
                "duration_option_id": str(option.id),
                "count": 1,
            }
        case "ketones":
            return base | {"value": 2.5, "method": "blood"}
        case "weight":
            return base | {"weight_kg": 18.4}
        case "medications":
            doctor = await make_user(UserRole.DOCTOR)
            medication = await _medication(session, patient=patient, author=doctor)
            return base | {"medication_id": str(medication.id), "taken": True}
        case "meals":
            return base | {"free_text": "Омлет на сливочном масле"}
        case "side-effects":
            return base | {"symptom": "Тошнота"}
    raise AssertionError(kind)


#: Правка, которую делает форма «Исправить»: тело целиком, как собирает кит.
def _patch_body(kind: str, created: dict) -> dict:
    occurred_at = created["occurred_at"]
    match kind:
        case "seizures":
            return {
                "occurred_at": occurred_at,
                "seizure_type_id": created["seizure_type_id"],
                "duration_sec": None,
                "duration_option_id": created["duration_option_id"],
                "count": 3,
                "description": "Во сне",
                "triggers": None,
            }
        case "ketones":
            return {"occurred_at": occurred_at, "value": 1.8, "method": "urine"}
        case "weight":
            return {"occurred_at": occurred_at, "weight_kg": 18.6, "height_cm": None}
        case "medications":
            return {
                "occurred_at": occurred_at,
                "medication_id": created["medication_id"],
                "taken": False,
            }
        case "meals":
            return {"occurred_at": occurred_at, "free_text": "Сырники"}
        case "side-effects":
            return {"occurred_at": occurred_at, "symptom": "Вялость", "description": None}
    raise AssertionError(kind)


class TestDiaryFromMiniApp:
    """Потребитель — `DiaryEntries` и `EntryEditSheet` в Mini App."""

    @pytest.mark.parametrize("kind", list(FIELDS_BY_KIND))
    async def test_list_patch_delete_with_a_miniapp_session(
        self, client, session, make_user, make_patient, kind
    ):
        parent, patient, headers = await _open_miniapp(client, session, make_user, make_patient)
        url = f"/api/v1/patients/{patient.id}/logs/{kind}"
        body = await _create_body(session, kind, patient=patient, make_user=make_user)

        created = await client.post(url, headers=headers, json=body)
        assert created.status_code == 201, created.text
        log = created.json()

        # Список — тот же запрос, что у ленты: период с поясом и страница.
        now = datetime.now(UTC)
        listed = await client.get(
            url,
            headers=headers,
            params={
                "from": (now - timedelta(days=14)).isoformat(),
                "to": (now + timedelta(hours=1)).isoformat(),
                "limit": 200,
                "offset": 0,
            },
        )
        assert listed.status_code == 200, listed.text
        page = listed.json()
        assert page["total"] == 1
        item = page["items"][0]
        missing = (COMMON | FIELDS_BY_KIND[kind]) - set(item)
        assert not missing, f"лента Mini App читает {missing}"
        # «Своя запись» определяется по автору: лента сверяет `created_by` с
        # тем, кто вошёл, — сервер обязан записать автором именно его.
        assert item["created_by"] == str(parent.id)

        patched = await client.patch(
            f"{url}/{log['id']}", headers=headers, json=_patch_body(kind, log)
        )
        assert patched.status_code == 200, patched.text
        for field, value in _patch_body(kind, log).items():
            if field != "occurred_at":
                assert patched.json()[field] == value, field

        deleted = await client.delete(f"{url}/{log['id']}", headers=headers)
        assert deleted.status_code == 204

        after = await client.get(url, headers=headers)
        assert after.json()["total"] == 0

    async def test_seizure_patch_still_refuses_both_durations(
        self, client, session, make_user, make_patient
    ):
        """Форма Mini App проверяет «одно из двух», но решает сервер (ADR-0020)."""

        _, patient, headers = await _open_miniapp(client, session, make_user, make_patient)
        url = f"/api/v1/patients/{patient.id}/logs/seizures"
        body = await _create_body(session, "seizures", patient=patient, make_user=make_user)
        log = (await client.post(url, headers=headers, json=body)).json()

        response = await client.patch(
            f"{url}/{log['id']}", headers=headers, json={"duration_sec": 90}
        )
        assert response.status_code == 422, response.text

    async def test_names_for_the_entries_are_readable_by_the_family(
        self, client, session, make_user, make_patient
    ):
        """Названия типов, интервалов и препаратов — то, чем лента называет запись.

        Без них «Приступ» был бы без типа, а «Лекарство» — без имени.
        """

        _, patient, headers = await _open_miniapp(client, session, make_user, make_patient)
        await _seizure_type(session)
        await _duration_option(session)
        doctor = await make_user(UserRole.DOCTOR)
        await _medication(session, patient=patient, author=doctor)

        types = await client.get(
            "/api/v1/dictionaries/seizure-types",
            headers=headers,
            params={"limit": 200, "offset": 0},
        )
        assert types.status_code == 200, types.text
        assert {"id", "name_ru"} <= set(types.json()["items"][0])

        options = await client.get(
            "/api/v1/dictionaries/intake-options",
            headers=headers,
            params={"scale": "seizure_duration"},
        )
        assert options.status_code == 200, options.text
        assert {"id", "name_ru"} <= set(options.json()["items"][0])

        medications = await client.get(
            f"/api/v1/patients/{patient.id}/medications",
            headers=headers,
            params={"limit": 200, "offset": 0},
        )
        assert medications.status_code == 200, medications.text
        assert {"id", "drug_name", "dose"} <= set(medications.json()["items"][0])

    async def test_another_childs_diary_stays_closed(
        self, client, session, make_user, make_patient
    ):
        _, _, headers = await _open_miniapp(client, session, make_user, make_patient)
        stranger = await make_patient()

        response = await client.get(f"/api/v1/patients/{stranger.id}/logs/ketones", headers=headers)
        assert response.status_code == 403


class TestRemindersFromMiniApp:
    """Потребитель — `RemindersBlock` на главной Mini App."""

    async def test_defaults_then_save_with_a_miniapp_session(
        self, client, session, make_user, make_patient
    ):
        _, patient, headers = await _open_miniapp(client, session, make_user, make_patient)
        url = f"/api/v1/patients/{patient.id}/reminders"

        current = await client.get(url, headers=headers)
        assert current.status_code == 200, current.text
        body = current.json()
        assert set(body) == {
            "patient_id",
            "enabled",
            "ketones_at",
            "weight_at",
            "medications_at",
            "no_records_at",
        }
        # Блок показывает умолчания сервера и своих не держит.
        assert body["enabled"] is True
        assert body["no_records_at"] is not None

        # Блок отправляет «08:00» из поля времени и «20:00:00» из ответа
        # сервера нетронутыми — оба вида записи обязаны приниматься.
        saved = await client.put(
            url,
            headers=headers,
            json={
                "enabled": True,
                "ketones_at": "08:00",
                "weight_at": None,
                "medications_at": None,
                "no_records_at": body["no_records_at"],
            },
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["ketones_at"].startswith("08:00")

        again = await client.get(url, headers=headers)
        assert again.json()["ketones_at"].startswith("08:00")

    async def test_another_childs_reminders_stay_closed(
        self, client, session, make_user, make_patient
    ):
        _, _, headers = await _open_miniapp(client, session, make_user, make_patient)
        stranger = await make_patient()

        response = await client.put(
            f"/api/v1/patients/{stranger.id}/reminders",
            headers=headers,
            json={"enabled": False},
        )
        assert response.status_code == 403
