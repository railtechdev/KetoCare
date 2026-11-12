"""Кнопки под сообщениями воркера и тихие часы (ADR-0076).

Напоминание несёт кнопку, которую понимает бот, уведомление — кнопку
приложения на нужном экране. Разметка уходит в `sendMessage` как есть,
поэтому проверяется сама форма словаря Bot API.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pytest

from worker.reminders import buttons, telegram, texts

PATIENT = uuid.UUID("11111111-1111-1111-1111-111111111111")
APP = "https://tma.example.uz/"
TZ = ZoneInfo("Asia/Tashkent")


class TestReminderButtons:
    @pytest.mark.parametrize(
        ("kind", "action"),
        [
            ("ketones", "ketones"),
            ("weight", "weight"),
            ("medications", "medications"),
            ("no_records", "wellbeing"),
        ],
    )
    def test_reminder_starts_the_bot_scenario_for_this_child(self, kind, action):
        markup = buttons.reminder(kind, patient_id=PATIENT, language="ru", base="")

        assert markup is not None
        first = markup["inline_keyboard"][0][0]
        assert first["callback_data"] == f"rem:{action}:{PATIENT.hex}"
        assert len(first["callback_data"].encode()) <= 64, "предел callback_data Telegram"
        assert first["text"] == texts.text("ru", f"btn_record_{action}")

    def test_evening_reminder_also_opens_the_diary(self):
        markup = buttons.reminder("no_records", patient_id=PATIENT, language="uz", base=APP)

        assert markup is not None
        app = markup["inline_keyboard"][1][0]
        assert app["web_app"] == {"url": "https://tma.example.uz/?open=diary"}
        assert app["text"] == texts.text("uz", "btn_open_diary")

    def test_unknown_kind_has_no_buttons(self):
        assert (
            buttons.reminder("control_visit", patient_id=PATIENT, language="ru", base=APP) is None
        )


class TestAppButton:
    def test_opens_the_screen_named_by_the_contract(self):
        markup = buttons.open_app("ru", base=APP, target="menu", label_key="btn_open_menu")

        assert markup == {
            "inline_keyboard": [
                [
                    {
                        "text": texts.text("ru", "btn_open_menu"),
                        "web_app": {"url": "https://tma.example.uz/?open=menu"},
                        "style": "primary",
                    }
                ]
            ]
        }

    @pytest.mark.parametrize("base", ["", "http://tma.example.uz", "  "])
    def test_no_https_address_means_no_button(self, base):
        """Telegram отвергает web_app без https — и всё сообщение вместе с ним."""

        assert buttons.open_app("ru", base=base, target="menu", label_key="btn_open_menu") is None

    def test_existing_query_is_kept_and_open_replaced(self):
        url = buttons.app_link("https://tma.example.uz/app?lang=uz&open=old", "family")
        assert url == "https://tma.example.uz/app?lang=uz&open=family"

    def test_unknown_screen_is_refused(self):
        assert buttons.app_link(APP, "admin") is None

    def test_targets_match_the_mini_app_contract(self):
        assert {
            "today",
            "menu",
            "diary",
            "diary-seizures",
            "diary-ketones",
            "diary-weight",
            "diary-medications",
            "diary-side-effects",
            "settings",
            "family",
            "reminders",
        } == buttons.OPEN_TARGETS


class TestQuietHours:
    @pytest.mark.parametrize(
        ("hour", "minute", "silent"),
        [
            (22, 0, True),
            (23, 59, True),
            (3, 0, True),
            (6, 59, True),
            (7, 0, False),
            (21, 59, False),
        ],
    )
    def test_night_is_silent(self, hour, minute, silent):
        moment = datetime.combine(datetime(2026, 11, 12).date(), time(hour, minute), tzinfo=TZ)
        assert buttons.quiet(moment) is silent


@pytest.mark.asyncio
class TestSendMessage:
    async def test_markup_and_silence_reach_telegram(self):
        seen: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            import json

            seen.update(json.loads(request.content))
            return httpx.Response(200, json={"ok": True})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await telegram.send_message(
                client,
                token="1:x",
                chat_id=7,
                text="Напоминание",
                reply_markup={"inline_keyboard": [[{"text": "a", "callback_data": "b"}]]},
                disable_notification=True,
            )

        assert seen == {
            "chat_id": 7,
            "text": "Напоминание",
            "reply_markup": {"inline_keyboard": [[{"text": "a", "callback_data": "b"}]]},
            "disable_notification": True,
        }

    async def test_plain_message_stays_plain(self):
        seen: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            import json

            seen.update(json.loads(request.content))
            return httpx.Response(200, json={"ok": True})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await telegram.send_message(client, token="1:x", chat_id=7, text="Текст")

        assert seen == {"chat_id": 7, "text": "Текст"}


@pytest.mark.asyncio
class TestNotificationsCarryTheAppButton:
    async def test_prescription_change_opens_the_menu_and_is_silent_at_night(self, monkeypatch):
        from contextlib import asynccontextmanager
        from types import SimpleNamespace

        from worker.reminders import notify

        monkeypatch.setenv("BOT_TOKEN", "000000:test")
        monkeypatch.setenv("MINIAPP_URL", APP)
        monkeypatch.setattr(notify, "_quiet", lambda settings: True)

        @asynccontextmanager
        async def fake_session():
            yield object()

        monkeypatch.setattr(notify, "get_sessionmaker", lambda: fake_session)

        async def links(session, patient_id):
            return [SimpleNamespace(chat_id=10, revoked_at=None, parent_id=None)]

        async def one_child(session, chat_ids):
            return dict.fromkeys(chat_ids, 1)

        monkeypatch.setattr(notify.telegram_repo, "list_links_for_patient", links)
        monkeypatch.setattr(notify.telegram_repo, "children_per_chat", one_child)
        sent: list[dict[str, Any]] = []

        async def send(client, *, token, chat_id, text, **extra):
            sent.append(extra)

        monkeypatch.setattr(notify, "send_message", send)

        assert await notify.notify_family({}, str(PATIENT)) == 1

        markup = sent[0]["reply_markup"]
        assert markup["inline_keyboard"][0][0]["web_app"]["url"] == f"{APP}?open=menu"
        assert sent[0]["disable_notification"] is True


def test_quiet_follows_the_project_clock(monkeypatch):
    from worker.reminders import notify

    class Frozen(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> datetime:  # type: ignore[override]
            return datetime(2026, 11, 12, 18, 30, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(notify, "datetime", Frozen)
    settings = type("S", (), {"tz": "Asia/Tashkent"})()
    # 18:30 UTC — 23:30 в Ташкенте.
    assert notify._quiet(settings) is True  # type: ignore[arg-type]
