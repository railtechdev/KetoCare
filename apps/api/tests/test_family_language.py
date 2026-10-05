"""Язык семейных каналов — бота, Mini App и сообщений в Telegram (ADR-0052).

Язык — свойство человека: его сохраняет сервер, а читают бот, Mini App и
рассылки воркера. Здесь — ручки, умолчание из Telegram и стык с двумя
потребителями: бот (`apps/bot`, `BotApi.get_language` / `set_language` и
`activate_access_code`) и Mini App (`apps/miniapp`, `useSession` и
`LanguageSwitch`).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from urllib.parse import urlencode

import pytest
from sqlalchemy import select

from api.deps.bot import BOT_ALLOWED_ROUTES
from api.services.telegram_initdata import parse_init_data
from core.config import get_settings
from core.models import User
from core.models.enums import UserRole
from core.repositories import patients as patients_repo
from core.repositories import telegram as telegram_repo

from .test_miniapp_auth import BOT_TOKEN, sign

CHAT_ID = 555012345


@pytest.fixture(autouse=True)
def bot_token(monkeypatch):
    """Подпись запуска считается ключом из токена теста, а не окружения."""

    monkeypatch.setenv("BOT_TOKEN", BOT_TOKEN)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def bot_headers() -> dict[str, str]:
    token = get_settings().bot_api_token
    assert token, "BOT_API_TOKEN не задан: канал бота выключен, проверять нечего."
    return {"X-Bot-Token": token}


def launch(*, chat_id: int = CHAT_ID, language_code: str | None = None) -> str:
    user: dict[str, object] = {"id": chat_id, "first_name": "Ona"}
    if language_code is not None:
        user["language_code"] = language_code
    fields = {
        "user": json.dumps(user, ensure_ascii=False),
        "auth_date": str(int(datetime.now(UTC).timestamp())),
    }
    return urlencode({**fields, "hash": sign(fields)})


async def _linked(session, make_user, make_patient, *, chat_id: int = CHAT_ID):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient("Amina")
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    secret = telegram_repo.generate_binding_secret()
    link = await telegram_repo.create_link(
        session, parent_id=parent.id, patient_id=patient.id, chat_id=chat_id, secret=secret
    )
    return parent, patient, link, secret


async def _bot_token(client, link, secret) -> str:
    response = await client.post(
        "/api/v1/auth/bot/session",
        headers=bot_headers(),
        json={"link_id": str(link.id), "secret": secret},
    )
    assert response.status_code == 200, response.text
    return str(response.json()["access_token"])


class TestInitData:
    def test_language_code_is_read_from_the_signed_user(self) -> None:
        assert parse_init_data(launch(language_code="uz"), bot_token=BOT_TOKEN).language_code == (
            "uz"
        )

    def test_missing_language_code_is_not_a_refusal(self) -> None:
        assert parse_init_data(launch(), bot_token=BOT_TOKEN).language_code is None


@pytest.mark.asyncio
class TestMyLanguage:
    async def test_unset_then_chosen(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)
        headers = auth_headers(parent)

        before = await client.get("/api/v1/users/me/language", headers=headers)
        assert before.status_code == 200, before.text
        assert before.json() == {"language": None}

        chosen = await client.put(
            "/api/v1/users/me/language", headers=headers, json={"language": "uz"}
        )
        assert chosen.status_code == 200, chosen.text
        assert chosen.json() == {"language": "uz"}

        again = await client.get("/api/v1/users/me/language", headers=headers)
        assert again.json() == {"language": "uz"}
        # Профиль показывает тот же выбор: одно поле, одно место хранения.
        me = await client.get("/api/v1/users/me", headers=headers)
        assert me.json()["language"] == "uz"

    async def test_unknown_language_is_refused(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        response = await client.put(
            "/api/v1/users/me/language", headers=auth_headers(parent), json={"language": "en"}
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_requires_a_session(self, client):
        response = await client.put("/api/v1/users/me/language", json={"language": "uz"})
        assert response.status_code == 401

    async def test_one_person_cannot_set_anothers_language(
        self, client, session, make_user, auth_headers
    ):
        """Ручка про «меня»: идентификатора человека в ней нет и подставить нечего."""

        first = await make_user(UserRole.PARENT)
        second = await make_user(UserRole.PARENT)

        await client.put(
            "/api/v1/users/me/language", headers=auth_headers(first), json={"language": "uz"}
        )

        await session.refresh(second)
        assert second.language is None


def test_language_routes_are_open_to_the_bot() -> None:
    """Потребитель — `apps/bot`: без этих строк кнопка «🌐» отвечала бы 403."""

    assert ("GET", "/users/me/language") in BOT_ALLOWED_ROUTES
    assert ("PUT", "/users/me/language") in BOT_ALLOWED_ROUTES


@pytest.mark.asyncio
class TestBotContract:
    """Потребитель — `apps/bot`: `BotApi.get_language`, `BotApi.set_language`."""

    async def test_bot_reads_and_writes_the_language_of_the_person_behind_the_link(
        self, client, session, make_user, make_patient
    ):
        parent, _, link, secret = await _linked(session, make_user, make_patient)
        headers = {"Authorization": f"Bearer {await _bot_token(client, link, secret)}"}

        read = await client.get("/api/v1/users/me/language", headers=headers)
        assert read.status_code == 200, read.text
        assert read.json() == {"language": None}

        written = await client.put(
            "/api/v1/users/me/language", headers=headers, json={"language": "uz"}
        )
        assert written.status_code == 200, written.text
        assert written.json() == {"language": "uz"}

        await session.refresh(parent)
        assert parent.language == "uz"

    async def test_bot_still_cannot_read_the_profile(
        self, client, session, make_user, make_patient
    ):
        """Язык открыт боту отдельной ручкой именно затем, чтобы не открывать профиль."""

        _, _, link, secret = await _linked(session, make_user, make_patient)
        headers = {"Authorization": f"Bearer {await _bot_token(client, link, secret)}"}

        response = await client.get("/api/v1/users/me", headers=headers)
        assert response.status_code == 403


@pytest.mark.asyncio
class TestActivationFromTelegram:
    """Потребитель — `apps/bot`: `BotApi.activate_access_code` читает `language`."""

    async def _code(self, client, session, make_user, make_patient, auth_headers) -> str:
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient("Amina")
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        response = await client.post(
            f"/api/v1/patients/{patient.id}/access-codes", headers=auth_headers(doctor)
        )
        assert response.status_code == 201, response.text
        return str(response.json()["code"])

    def _activate(self, client, code: str, language: str | None, *, chat_id: int = CHAT_ID):
        body: dict[str, object] = {
            "code": code,
            "chat_id": chat_id,
            "telegram_user_id": chat_id,
            "first_name": "Ona",
        }
        if language is not None:
            body["language"] = language
        return client.post(
            "/api/v1/auth/access-codes/activate-telegram", headers=bot_headers(), json=body
        )

    async def test_new_account_takes_the_bots_language(
        self, client, session, make_user, make_patient, auth_headers
    ):
        code = await self._code(client, session, make_user, make_patient, auth_headers)

        response = await self._activate(client, code, "uz")

        assert response.status_code == 201, response.text
        assert response.json()["language"] == "uz"
        parent = await session.scalar(select(User).where(User.telegram_user_id == CHAT_ID))
        assert parent is not None and parent.language == "uz"

    async def test_saved_choice_is_not_overwritten(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Выбор в Mini App сильнее умолчания бота."""

        first = await self._code(client, session, make_user, make_patient, auth_headers)
        assert (await self._activate(client, first, None)).status_code == 201
        parent = await session.scalar(select(User).where(User.telegram_user_id == CHAT_ID))
        assert parent is not None and parent.language is None
        parent.language = "ru"
        await session.flush()

        second = await self._code(client, session, make_user, make_patient, auth_headers)
        response = await self._activate(client, second, "uz")

        assert response.status_code == 201, response.text
        assert response.json()["language"] == "ru"
        await session.refresh(parent)
        assert parent.language == "ru"

    async def test_without_language_answers_russian_and_stores_nothing(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Бот до ADR-0052 языка не присылает — он и говорит по-русски."""

        code = await self._code(client, session, make_user, make_patient, auth_headers)

        response = await self._activate(client, code, None)

        assert response.status_code == 201, response.text
        assert response.json()["language"] == "ru"

    async def test_unknown_language_is_refused(
        self, client, session, make_user, make_patient, auth_headers
    ):
        code = await self._code(client, session, make_user, make_patient, auth_headers)

        response = await self._activate(client, code, "kk")

        assert response.status_code == 422


@pytest.mark.asyncio
class TestMiniAppContract:
    """Потребитель — `apps/miniapp`: `useSession` читает `language` из сессии."""

    async def test_telegram_language_becomes_the_default(
        self, client, session, make_user, make_patient
    ):
        parent, _, _, _ = await _linked(session, make_user, make_patient)

        response = await client.post(
            "/api/v1/auth/telegram-init", json={"init_data": launch(language_code="uz")}
        )

        assert response.status_code == 200, response.text
        assert response.json()["language"] == "uz"
        await session.refresh(parent)
        assert parent.language == "uz", "умолчание сохраняется: рассылкам спросить не у кого"

    async def test_saved_choice_beats_the_telegram_language(
        self, client, session, make_user, make_patient
    ):
        parent, _, _, _ = await _linked(session, make_user, make_patient)
        parent.language = "ru"
        await session.flush()

        response = await client.post(
            "/api/v1/auth/telegram-init", json={"init_data": launch(language_code="uz")}
        )

        assert response.json()["language"] == "ru"

    async def test_non_uzbek_telegram_means_russian(self, client, session, make_user, make_patient):
        parent, _, _, _ = await _linked(session, make_user, make_patient)

        response = await client.post(
            "/api/v1/auth/telegram-init", json={"init_data": launch(language_code="en")}
        )

        assert response.json()["language"] == "ru"
        await session.refresh(parent)
        assert parent.language == "ru"

    async def test_no_language_code_answers_russian_without_storing(
        self, client, session, make_user, make_patient
    ):
        parent, _, _, _ = await _linked(session, make_user, make_patient)

        response = await client.post("/api/v1/auth/telegram-init", json={"init_data": launch()})

        assert response.json()["language"] == "ru"
        await session.refresh(parent)
        assert parent.language is None

    async def test_miniapp_session_can_change_the_language(
        self, client, session, make_user, make_patient
    ):
        parent, _, _, _ = await _linked(session, make_user, make_patient)
        opened = await client.post("/api/v1/auth/telegram-init", json={"init_data": launch()})
        headers = {"Authorization": f"Bearer {opened.json()['access_token']}"}

        response = await client.put(
            "/api/v1/users/me/language", headers=headers, json={"language": "uz"}
        )

        assert response.status_code == 200, response.text
        await session.refresh(parent)
        assert parent.language == "uz"
