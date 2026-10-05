"""Сообщения воркера на языке взрослого (ADR-0052).

Главное — паритет: узбекский каталог обязан содержать каждый русский ключ с
теми же переменными подстановки. Пропущенный ключ — `KeyError` вместо
напоминания, лишняя переменная — `KeyError` при `format`; оба отказа случились
бы только у узбекской семьи и только в тот час, когда напоминание должно уйти.
"""

from __future__ import annotations

import re
import uuid
from contextlib import asynccontextmanager
from datetime import date
from string import Formatter
from types import SimpleNamespace

import pytest

from worker.reminders import children, notify, texts
from worker.reminders.task import TEXT_KEYS, visit_notice_text


def placeholders(template: str) -> set[str]:
    return {name for _, name, _, _ in Formatter().parse(template) if name}


class TestCatalogParity:
    def test_same_keys(self) -> None:
        assert set(texts.UZ) == set(texts.RU)

    @pytest.mark.parametrize("key", sorted(texts.RU))
    def test_same_placeholders(self, key: str) -> None:
        assert placeholders(texts.UZ[key]) == placeholders(texts.RU[key])

    def test_twelve_months_each(self) -> None:
        assert {len(names) for names in texts.MONTHS.values()} == {12}

    def test_every_reminder_kind_exists_in_both_languages(self) -> None:
        for key in TEXT_KEYS.values():
            assert key in texts.RU and key in texts.UZ

    def test_uzbek_is_latin(self) -> None:
        """Узбекский — латиницей, как посадочная страница; кириллица — отдельный язык."""

        cyrillic = re.compile(r"[Ѐ-ӿ]")
        assert [key for key, value in texts.UZ.items() if cyrillic.search(value)] == []


class TestLanguageChoice:
    def test_unset_and_unknown_language_is_russian(self) -> None:
        assert texts.text(None, "reminder_ketones") == texts.RU["reminder_ketones"]
        assert texts.text("en", "reminder_ketones") == texts.RU["reminder_ketones"]

    def test_uzbek(self) -> None:
        assert texts.text("uz", "reminder_ketones") == texts.UZ["reminder_ketones"]

    def test_visit_date_in_uzbek(self) -> None:
        text = visit_notice_text(date(2026, 10, 9), ("Общий анализ крови",), language="uz")
        assert text.startswith("Eslatma: 9-oktabr")
        # Перечень анализов — клинический текст клиники: остаётся как прислан.
        assert "Общий анализ крови" in text

    def test_nudge_in_uzbek_names_role_and_person(self) -> None:
        text = notify.nudge_notice(
            specialist_name="Petrov Pyotr", specialist_role="doctor", language="uz"
        )
        assert text.startswith("Shifokor Petrov Pyotr")

    def test_menu_composed_in_uzbek_carries_no_numbers_but_the_date(self) -> None:
        text = notify.menu_composed_notice(
            composer_name="Anna",
            composer_role="dietitian",
            menu_date=date(2026, 10, 6),
            language="uz",
        )
        assert "06.10" in text and "dietolog" in text
        assert re.sub(r"06\.10", "", text) == re.sub(r"\d", "", re.sub(r"06\.10", "", text))


@pytest.mark.asyncio
class TestRecipientLanguage:
    async def test_each_chat_gets_its_adults_language(self, monkeypatch) -> None:
        mother, grandma = uuid.uuid4(), uuid.uuid4()
        links = [
            SimpleNamespace(chat_id=10, parent_id=mother, revoked_at=None),
            SimpleNamespace(chat_id=20, parent_id=grandma, revoked_at=None),
        ]

        async def stored(session, *, user_ids):
            return {mother: "uz", grandma: None}

        monkeypatch.setattr(children.users_repo, "languages_by_ids", stored)

        assert await children.chat_languages(object(), links) == {10: "uz", 20: "ru"}

    async def test_prescription_notice_goes_out_in_uzbek(self, monkeypatch) -> None:
        monkeypatch.setenv("BOT_TOKEN", "000000:test")
        parent = uuid.uuid4()

        @asynccontextmanager
        async def fake_session():
            yield object()

        async def links(session, patient_id):
            return [SimpleNamespace(chat_id=10, parent_id=parent, revoked_at=None)]

        async def one_child(session, chat_ids):
            return dict.fromkeys(chat_ids, 1)

        async def stored(session, *, user_ids):
            return {parent: "uz"}

        sent: list[str] = []

        async def send(client, *, token, chat_id, text):
            sent.append(text)

        monkeypatch.setattr(notify, "get_sessionmaker", lambda: fake_session)
        monkeypatch.setattr(notify.telegram_repo, "list_links_for_patient", links)
        monkeypatch.setattr(notify.telegram_repo, "children_per_chat", one_child)
        monkeypatch.setattr(children.users_repo, "languages_by_ids", stored)
        monkeypatch.setattr(notify, "send_message", send)

        assert await notify.notify_family({}, str(uuid.uuid4())) == 1
        assert sent == [texts.UZ["prescription_changed"]]
