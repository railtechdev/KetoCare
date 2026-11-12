"""Стык бота с дневником (ADR-0076). Потребитель — `apps/bot`.

Бот сохраняет запись сразу и под ответом даёт «Другое время», «Это была моча»
и «Удалить запись» (`BotApi.update_log`, `BotApi.delete_log`), а сценарий
«Приступ» начинается с типов прошлых записей (`BotApi.recent_seizure_types`).
Тесты бота работают с подделкой API; здесь — настоящие ручки с настоящим
токеном бота: маршрут открыт списком `BOT_ALLOWED_ROUTES`, правит только автор,
чужой ребёнок закрыт.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from api.deps.bot import BOT_ALLOWED_ROUTES
from core.config import get_settings
from core.models import SeizureType
from core.models.enums import UserRole
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo

KINDS = ("seizures", "ketones", "weight", "medications", "meals", "side-effects")


def bot_headers() -> dict[str, str]:
    token = get_settings().bot_api_token
    assert token, "BOT_API_TOKEN не задан: канал бота выключен, проверять нечего."
    return {"X-Bot-Token": token}


async def _linked(session, make_user, make_patient, *, chat_id: int = 555_076_001):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient("Amina")
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    secret = telegram_repo.generate_binding_secret()
    link = await telegram_repo.create_link(
        session, parent_id=parent.id, patient_id=patient.id, chat_id=chat_id, secret=secret
    )
    return parent, patient, link, secret


async def _bot_headers(client, link, secret) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/bot/session",
        headers=bot_headers(),
        json={"link_id": str(link.id), "secret": secret},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def _types(session, count: int) -> list[SeizureType]:
    found = list(
        (
            await session.scalars(
                select(SeizureType).where(SeizureType.retired.is_(False)).order_by(SeizureType.sort)
            )
        ).all()
    )
    while len(found) < count:
        extra = SeizureType(name_ru=f"Тип {len(found)}", sort=1000 + len(found))
        session.add(extra)
        await session.flush()
        found.append(extra)
    return found[:count]


def _ago(minutes: int) -> str:
    return (datetime.now(UTC) - timedelta(minutes=minutes)).isoformat()


def test_edit_and_delete_routes_are_open_to_the_bot() -> None:
    for kind in KINDS:
        assert ("PATCH", f"/patients/{{patient_id}}/logs/{kind}/{{log_id}}") in BOT_ALLOWED_ROUTES
        assert ("DELETE", f"/patients/{{patient_id}}/logs/{kind}/{{log_id}}") in BOT_ALLOWED_ROUTES
    assert ("GET", "/patients/{patient_id}/logs/seizures/recent-types") in BOT_ALLOWED_ROUTES


def test_the_bot_still_cannot_read_the_diary() -> None:
    """Недавние типы открыты отдельной ручкой именно затем, чтобы не открывать список."""

    for kind in KINDS:
        assert ("GET", f"/patients/{{patient_id}}/logs/{kind}") not in BOT_ALLOWED_ROUTES


@pytest.mark.asyncio
class TestRecentSeizureTypes:
    """`BotApi.recent_seizure_types`: `{"items": [uuid, …]}`, свежие первыми."""

    async def test_distinct_types_most_recent_first(self, client, session, make_user, make_patient):
        _, patient, link, secret = await _linked(session, make_user, make_patient)
        headers = await _bot_headers(client, link, secret)
        first, second, third = await _types(session, 3)
        base = f"/api/v1/patients/{patient.id}/logs/seizures"
        for type_, minutes in ((first, 300), (second, 200), (first, 100), (third, 400)):
            created = await client.post(
                base,
                headers=headers | {"Idempotency-Key": str(uuid.uuid4())},
                json={"occurred_at": _ago(minutes), "seizure_type_id": str(type_.id)},
            )
            assert created.status_code == 201, created.text

        response = await client.get(f"{base}/recent-types?limit=2", headers=headers)

        assert response.status_code == 200, response.text
        assert response.json() == {"items": [str(first.id), str(second.id)]}

    async def test_deleted_records_and_retired_types_do_not_count(
        self, client, session, make_user, make_patient
    ):
        _, patient, link, secret = await _linked(session, make_user, make_patient)
        headers = await _bot_headers(client, link, secret)
        kept, removed = await _types(session, 2)
        base = f"/api/v1/patients/{patient.id}/logs/seizures"
        ids = {}
        for type_ in (kept, removed):
            created = await client.post(
                base,
                headers=headers | {"Idempotency-Key": str(uuid.uuid4())},
                json={"occurred_at": _ago(10), "seizure_type_id": str(type_.id)},
            )
            ids[type_.id] = created.json()["id"]
        deleted = await client.delete(f"{base}/{ids[removed.id]}", headers=headers)
        assert deleted.status_code == 204

        response = await client.get(f"{base}/recent-types", headers=headers)
        assert response.json() == {"items": [str(kept.id)]}

        kept.retired = True
        await session.flush()
        response = await client.get(f"{base}/recent-types", headers=headers)
        assert response.json() == {"items": []}

    async def test_foreign_child_is_refused(self, client, session, make_user, make_patient):
        _, _, link, secret = await _linked(session, make_user, make_patient)
        other = await make_patient("Timur")
        headers = await _bot_headers(client, link, secret)

        response = await client.get(
            f"/api/v1/patients/{other.id}/logs/seizures/recent-types", headers=headers
        )
        assert response.status_code == 403

    async def test_limit_is_bounded(self, client, session, make_user, make_patient):
        _, patient, link, secret = await _linked(session, make_user, make_patient)
        headers = await _bot_headers(client, link, secret)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/logs/seizures/recent-types?limit=50", headers=headers
        )
        assert response.status_code == 422


@pytest.mark.asyncio
class TestEditFromTheBot:
    """`BotApi.update_log` / `BotApi.delete_log` — автор записи — взрослый за привязкой."""

    async def test_bot_moves_its_record_in_time_and_switches_the_method(
        self, client, session, make_user, make_patient
    ):
        _, patient, link, secret = await _linked(session, make_user, make_patient)
        headers = await _bot_headers(client, link, secret)
        base = f"/api/v1/patients/{patient.id}/logs/ketones"
        created = await client.post(
            base,
            headers=headers | {"Idempotency-Key": str(uuid.uuid4())},
            json={"occurred_at": _ago(1), "value": "1.2", "method": "blood"},
        )
        assert created.status_code == 201, created.text
        log_id = created.json()["id"]

        moved_to = datetime.now(UTC) - timedelta(hours=1)
        patched = await client.patch(
            f"{base}/{log_id}",
            headers=headers,
            json={"occurred_at": moved_to.isoformat(), "method": "urine"},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["method"] == "urine"
        assert datetime.fromisoformat(patched.json()["occurred_at"]) == moved_to

    async def test_bot_deletes_its_record(self, client, session, make_user, make_patient):
        _, patient, link, secret = await _linked(session, make_user, make_patient)
        headers = await _bot_headers(client, link, secret)
        base = f"/api/v1/patients/{patient.id}/logs/weight"
        created = await client.post(
            base,
            headers=headers | {"Idempotency-Key": str(uuid.uuid4())},
            json={"occurred_at": _ago(1), "weight_kg": "18.4"},
        )
        log_id = created.json()["id"]

        response = await client.delete(f"{base}/{log_id}", headers=headers)
        assert response.status_code == 204

    async def test_skipped_medication_is_accepted(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """«Пропустили» пишет `taken: false` — схема его принимает."""

        from core.models import Medication

        _, patient, link, secret = await _linked(session, make_user, make_patient)
        doctor = await make_user(UserRole.DOCTOR)
        medication = Medication(
            patient_id=patient.id,
            drug_name="Вальпроат",
            dose="200 мг",
            frequency="2 раза в день",
            started_at=datetime.now(UTC).date(),
            author_id=doctor.id,
        )
        session.add(medication)
        await session.flush()
        headers = await _bot_headers(client, link, secret)

        response = await client.post(
            f"/api/v1/patients/{patient.id}/logs/medications",
            headers=headers | {"Idempotency-Key": str(uuid.uuid4())},
            json={"occurred_at": _ago(1), "medication_id": str(medication.id), "taken": False},
        )
        assert response.status_code == 201, response.text
        assert response.json()["taken"] is False

    async def test_bot_cannot_touch_another_adults_record(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient, link, secret = await _linked(session, make_user, make_patient)
        other_parent = await make_user(UserRole.PARENT)
        await patients_repo.link_parent(session, parent_id=other_parent.id, patient_id=patient.id)
        base = f"/api/v1/patients/{patient.id}/logs/weight"
        created = await client.post(
            base,
            headers=auth_headers(other_parent) | {"Idempotency-Key": str(uuid.uuid4())},
            json={"occurred_at": _ago(1), "weight_kg": "18.4"},
        )
        assert created.status_code == 201, created.text
        headers = await _bot_headers(client, link, secret)

        log_id = created.json()["id"]
        assert (await client.delete(f"{base}/{log_id}", headers=headers)).status_code == 403
        patched = await client.patch(
            f"{base}/{log_id}", headers=headers, json={"occurred_at": _ago(30)}
        )
        assert patched.status_code == 403

    async def test_foreign_childs_record_is_refused(self, client, session, make_user, make_patient):
        _, _, link, secret = await _linked(session, make_user, make_patient)
        other = await make_patient("Timur")
        headers = await _bot_headers(client, link, secret)

        response = await client.delete(
            f"/api/v1/patients/{other.id}/logs/weight/{uuid.uuid4()}", headers=headers
        )
        assert response.status_code == 403
