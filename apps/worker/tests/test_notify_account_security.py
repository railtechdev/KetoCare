"""Сообщения о безопасности учётной записи (находки Н2 и Н7 security-прохода).

Подключён новый Telegram кодом «своего чата», включён вход в кабинет — владелец
обязан узнать об этом в прежних чатах, даже если это сделал не он.
"""

from __future__ import annotations

import re
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any

import pytest

from worker.reminders import notify, texts


@pytest.fixture
def delivery(monkeypatch: pytest.MonkeyPatch) -> list[tuple[int, str]]:
    monkeypatch.setenv("BOT_TOKEN", "000000:test")

    @asynccontextmanager
    async def fake_session():  # type: ignore[no-untyped-def]
        yield object()

    monkeypatch.setattr(notify, "get_sessionmaker", lambda: fake_session)

    async def links(session: Any, parent_id: uuid.UUID) -> list[SimpleNamespace]:
        # Чат 10 ведёт двоих детей — сообщение уходит в него один раз.
        return [
            SimpleNamespace(chat_id=10),
            SimpleNamespace(chat_id=10),
            SimpleNamespace(chat_id=20),
        ]

    monkeypatch.setattr(notify.telegram_repo, "list_live_links_for_parent", links)

    async def language(session: Any, parent_id: uuid.UUID) -> str | None:
        return None

    monkeypatch.setattr(notify, "parent_language", language)
    sent: list[tuple[int, str]] = []

    async def send(client: Any, *, token: str, chat_id: int, text: str) -> None:
        sent.append((chat_id, text))

    monkeypatch.setattr(notify, "send_message", send)
    return sent


class TestAccountSecurityNotice:
    async def test_new_device_is_announced_to_the_other_chats_only(
        self, delivery: list[tuple[int, str]]
    ) -> None:
        delivered = await notify.notify_account_security({}, str(uuid.uuid4()), "device_linked", 20)

        assert delivered == 1
        assert delivery == [(10, texts.RU["device_linked"])]

    async def test_web_login_is_announced_to_every_chat(
        self, delivery: list[tuple[int, str]]
    ) -> None:
        delivered = await notify.notify_account_security(
            {}, str(uuid.uuid4()), "web_credentials_set"
        )

        assert delivered == 2
        assert [chat for chat, _ in delivery] == [10, 20]

    async def test_unknown_event_sends_nothing(self, delivery: list[tuple[int, str]]) -> None:
        assert await notify.notify_account_security({}, str(uuid.uuid4()), "whatever") == 0
        assert delivery == []

    @pytest.mark.parametrize("event", sorted(notify.ACCOUNT_SECURITY_EVENTS))
    def test_text_names_the_next_step_in_both_languages(self, event: str) -> None:
        """Тревога без следующего шага бесполезна; чисел и имён — ни одного."""

        assert "врачу" in texts.RU[event]
        assert "shifokor" in texts.UZ[event]
        for text in (texts.RU[event], texts.UZ[event]):
            assert re.search(r"\d", text) is None
