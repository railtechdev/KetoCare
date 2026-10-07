"""Кто прочтёт вопрос помощнику — стык на стороне поставщика (ADR-0022).

Потребители — строка над полем вопроса в кабинете
(`apps/web/src/features/assistant/AssistantPage.tsx`) и в Mini App
(`apps/miniapp/src/features/assistant/AssistantScreen.tsx`). Обе берут имена из
`GET /patients/{id}/doctors` и печатают «имя (роль)». Их тесты работают с
подделкой ответа, поэтому форма и, главное, совпадение перечня с теми, кого
сервер пускает к переписке, проверяются здесь.

Mini App — отдельная сессия (подпись Telegram, сужённая до ребёнка), и ручку
она до этой правки не вызывала: ограничений маршрутов у канала нет по
построению, но обещание «нет» без теста однажды перестаёт быть правдой.
"""

from __future__ import annotations

import pytest

from core.models.enums import UserRole
from core.repositories import patients as patients_repo

from .test_miniapp_auth import _linked_family, bot_token, init_data  # noqa: F401

pytestmark = pytest.mark.asyncio


async def test_miniapp_family_reads_who_reads_the_conversation(
    client, session, make_user, make_patient, auth_headers
):
    _, patient, _ = await _linked_family(session, make_user, make_patient)
    doctor = await make_user(UserRole.DOCTOR)
    dietitian = await make_user(UserRole.DIETITIAN)
    stranger = await make_user(UserRole.DOCTOR)
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    await patients_repo.link_doctor(session, doctor_id=dietitian.id, patient_id=patient.id)

    opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": init_data()})
    assert opened.status_code == 200, opened.text
    headers = {"Authorization": f"Bearer {opened.json()['access_token']}"}

    response = await client.get(f"/api/v1/patients/{patient.id}/doctors", headers=headers)

    assert response.status_code == 200, response.text
    team = response.json()
    # Экран читает ровно эти поля; почты и телефона специалиста семье не уходит.
    assert all(set(item) == {"id", "role", "full_name"} for item in team)
    assert {(item["id"], item["role"]) for item in team} == {
        (str(doctor.id), "doctor"),
        (str(dietitian.id), "dietitian"),
    }

    # Перечень совпадает с правом: названный специалист переписку читает,
    # не названный — нет. Иначе строка над полем обещала бы не то, что есть.
    conversations = f"/api/v1/patients/{patient.id}/ai-conversations"
    for reader in (doctor, dietitian):
        seen = await client.get(conversations, headers=auth_headers(reader))
        assert seen.status_code == 200, seen.text
    assert (await client.get(conversations, headers=auth_headers(stranger))).status_code == 403
