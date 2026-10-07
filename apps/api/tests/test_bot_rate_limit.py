"""Лимит частоты ручек бота — у каждого человека и каждой привязки свой (Н13).

Весь бот приходит с одного адреса. Пока лимит считался только по адресу, один
человек, присылавший два `/start XXXXXXXX` в секунду, оставлял все семьи без
привязки и без сессий бота. Потребитель — `apps/bot` (`BotApi.activate_code`,
`BotApi.session`).
"""

from __future__ import annotations

import uuid

import pytest
from limits import parse

from api.ratelimit import (
    BOT_ACTIVATE_PER_USER_LIMIT,
    BOT_RATE_LIMIT,
    BOT_SESSION_PER_LINK_LIMIT,
)
from core.config import get_settings
from core.models.enums import UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio


def bot_headers() -> dict[str, str]:
    token = get_settings().bot_api_token
    assert token, "BOT_API_TOKEN не задан: канал бота выключен, проверять нечего."
    return {"X-Bot-Token": token}


def _activation(code: str, telegram_user_id: int) -> dict[str, object]:
    return {
        "code": code,
        "chat_id": telegram_user_id,
        "telegram_user_id": telegram_user_id,
        "first_name": "Айгуль",
    }


async def test_one_person_does_not_lock_out_other_families(
    client, session, make_user, make_patient, auth_headers
):
    noisy, family = 771_100_001, 771_100_002
    per_user = parse(BOT_ACTIVATE_PER_USER_LIMIT).amount

    for _ in range(per_user):
        response = await client.post(
            "/api/v1/auth/access-codes/activate-telegram",
            headers=bot_headers(),
            json=_activation("ZZZZZZZZ", noisy),
        )
        assert response.status_code != 429, response.text

    refused = await client.post(
        "/api/v1/auth/access-codes/activate-telegram",
        headers=bot_headers(),
        json=_activation("ZZZZZZZZ", noisy),
    )
    assert refused.status_code == 429
    assert refused.json()["error"]["code"] == "rate_limited"

    # С того же адреса — весь бот один процесс — другая семья гасит свой код.
    doctor = await make_user(UserRole.DOCTOR)
    patient = await make_patient("Амина")
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    code = (
        await client.post(
            f"/api/v1/patients/{patient.id}/access-codes", headers=auth_headers(doctor)
        )
    ).json()["code"]

    response = await client.post(
        "/api/v1/auth/access-codes/activate-telegram",
        headers=bot_headers(),
        json=_activation(code, family),
    )
    assert response.status_code == 201, response.text


async def test_session_bucket_is_per_link(client):
    noisy, other = str(uuid.uuid4()), str(uuid.uuid4())
    per_link = parse(BOT_SESSION_PER_LINK_LIMIT).amount
    body = {"secret": "x" * 43}

    for _ in range(per_link):
        response = await client.post(
            "/api/v1/auth/bot/session", headers=bot_headers(), json={"link_id": noisy, **body}
        )
        assert response.status_code != 429, response.text

    refused = await client.post(
        "/api/v1/auth/bot/session", headers=bot_headers(), json={"link_id": noisy, **body}
    )
    assert refused.status_code == 429

    response = await client.post(
        "/api/v1/auth/bot/session", headers=bot_headers(), json={"link_id": other, **body}
    )
    assert response.status_code != 429, "чужая привязка не делит ведро с шумной"


def test_address_ceiling_is_far_above_living_work():
    """Потолок по адресу один на весь бот: он ловит сорвавшийся процесс, а не
    человека. Прежние 120/мин человек выбирал за две минуты."""

    ceiling = parse(BOT_RATE_LIMIT)
    per_user = parse(BOT_ACTIVATE_PER_USER_LIMIT)
    assert ceiling.amount >= 100 * per_user.amount
