"""Уведомление семьи о новом назначении (раздел 5.4 ТЗ).

Проверяется главным образом то, чего в тексте быть НЕ должно: раздел 7.5 ТЗ
запрещает боту показывать параметры назначения. Запрет не формальный — чат мог
быть привязан к групповому, и кетосоотношение с калорийностью ушли бы всем его
участникам.
"""

from __future__ import annotations

import re

from worker.reminders.notify import NOTICE


class TestNoticeText:
    def test_carries_no_numbers(self) -> None:
        """Ни кетосоотношения, ни калорийности, ни граммов (раздел 7.5 ТЗ)."""

        assert re.search(r"\d", NOTICE) is None

    def test_says_the_prescription_changed(self) -> None:
        # Формулировка раздела 5.4 ТЗ: «Врач обновил назначение».
        assert "назначение" in NOTICE.lower()

    def test_sends_the_family_to_the_app(self) -> None:
        """Без этого сообщение читается как справка, а не как повод действовать.

        В приложение, а не в кабинет: у взрослых из Telegram кабинета чаще
        всего нет, а план дня собирается в приложении (ADR-0041).
        """

        assert "приложени" in NOTICE.lower()
        assert "кабинет" not in NOTICE.lower()
        assert "план питания" in NOTICE.lower()

    def test_carries_no_names(self) -> None:
        """Чат привязан к одному ребёнку — называть его по имени незачем."""

        assert "ребён" not in NOTICE.lower()


class TestFamilyJoined:
    """Уведомление о новом близком (ADR-0043)."""

    def test_names_the_newcomer_and_who_invited(self) -> None:
        from worker.reminders.notify import joined_notice

        text = joined_notice(newcomer_name="Мария", inviter_name="Анна")
        assert "Мария" in text and "Анна" in text

    def test_says_where_to_close_access(self) -> None:
        """Сообщение без следующего шага — тревога без выхода."""
        from worker.reminders.notify import joined_notice

        text = joined_notice(newcomer_name="Мария", inviter_name=None)
        assert "«Близкие»" in text
        assert "None" not in text

    def test_skips_the_newcomer_and_revoked_chats(self) -> None:
        import uuid
        from datetime import UTC, datetime
        from types import SimpleNamespace

        from worker.reminders.notify import joined_recipients

        mother, grandma = uuid.uuid4(), uuid.uuid4()
        links = [
            SimpleNamespace(parent_id=mother, chat_id=1, revoked_at=None),
            SimpleNamespace(parent_id=mother, chat_id=1, revoked_at=None),
            SimpleNamespace(parent_id=mother, chat_id=2, revoked_at=datetime.now(UTC)),
            SimpleNamespace(parent_id=grandma, chat_id=3, revoked_at=None),
        ]

        assert joined_recipients(links, newcomer_id=grandma) == [1]


class TestFamilyNudge:
    """Просьба специалиста отметить дневник (ADR-0046, аудит блокеров C5)."""

    def test_names_who_asks_and_nothing_else(self) -> None:
        from worker.reminders.notify import nudge_notice

        text = nudge_notice(specialist_name="Иванова Мария Петровна", specialist_role="doctor")

        assert text.startswith("Врач Иванова Мария Петровна просит")
        assert "дневник" in text
        # Ни чисел (раздел 7.5 ТЗ), ни упоминания ребёнка.
        assert re.search(r"\d", text) is None
        assert "ребён" not in text.lower()

    def test_role_in_words(self) -> None:
        from worker.reminders.notify import nudge_notice

        assert nudge_notice(specialist_name="А", specialist_role="dietitian").startswith(
            "Диетолог А "
        )
        assert nudge_notice(specialist_name="А", specialist_role="other").startswith(
            "Специалист А "
        )

    def test_recipients_are_live_chats_once(self) -> None:
        from datetime import UTC, datetime
        from types import SimpleNamespace

        from worker.reminders.notify import nudge_recipients

        links = [
            SimpleNamespace(chat_id=1, revoked_at=None),
            SimpleNamespace(chat_id=1, revoked_at=None),
            SimpleNamespace(chat_id=2, revoked_at=datetime.now(UTC)),
            SimpleNamespace(chat_id=3, revoked_at=None),
        ]

        assert nudge_recipients(links) == [1, 3]

    async def test_sends_to_every_live_chat_without_the_child_name(self, monkeypatch) -> None:
        import uuid
        from contextlib import asynccontextmanager
        from types import SimpleNamespace

        from worker.reminders import notify

        monkeypatch.setenv("BOT_TOKEN", "000000:test")

        @asynccontextmanager
        async def fake_session():
            yield object()

        monkeypatch.setattr(notify, "get_sessionmaker", lambda: fake_session)

        async def links(session, patient_id):
            return [
                SimpleNamespace(chat_id=10, revoked_at=None),
                SimpleNamespace(chat_id=20, revoked_at=None),
            ]

        monkeypatch.setattr(notify.telegram_repo, "list_links_for_patient", links)
        sent: list[tuple[int, str]] = []

        async def send(client, *, token, chat_id, text):
            sent.append((chat_id, text))

        monkeypatch.setattr(notify, "send_message", send)

        delivered = await notify.notify_family_nudge(
            {}, str(uuid.uuid4()), "Петров Пётр", "dietitian"
        )

        assert delivered == 2
        assert [chat for chat, _ in sent] == [10, 20]
        assert all(text.startswith("Диетолог Петров Пётр") for _, text in sent)


class TestMenuComposed:
    """Уведомление о плане дня от специалиста (ADR-0047)."""

    def test_names_the_specialist_role_and_date(self) -> None:
        from datetime import date

        from worker.reminders.notify import menu_composed_notice

        text = menu_composed_notice(
            composer_name="Анна Петровна", composer_role="dietitian", menu_date=date(2026, 10, 6)
        )
        assert text == (
            "Анна Петровна, диетолог, составил(а) план питания на 06.10. "
            "Откройте приложение, вкладка «Меню»."
        )

    def test_doctor_and_unknown_role(self) -> None:
        from datetime import date

        from worker.reminders.notify import menu_composed_notice

        day = date(2026, 10, 6)
        doctor = menu_composed_notice(composer_name="И", composer_role="doctor", menu_date=day)
        other = menu_composed_notice(composer_name="И", composer_role="admin", menu_date=day)
        assert ", врач," in doctor
        assert ", специалист," in other

    def test_carries_no_grams_ratio_or_child(self) -> None:
        """Только дата — никаких граммов и соотношения (раздел 7.5 ТЗ)."""
        from datetime import date

        from worker.reminders.notify import menu_composed_notice

        text = menu_composed_notice(
            composer_name="Анна", composer_role="doctor", menu_date=date(2026, 10, 6)
        )
        assert re.findall(r"\d+", text) == ["06", "10"]
        assert " г " not in text and ":" not in text
        assert "ребён" not in text.lower()

    def test_goes_to_live_chats_once(self) -> None:
        import uuid
        from datetime import UTC, datetime
        from types import SimpleNamespace

        from worker.reminders.notify import live_chats

        links = [
            SimpleNamespace(parent_id=uuid.uuid4(), chat_id=1, revoked_at=None),
            SimpleNamespace(parent_id=uuid.uuid4(), chat_id=1, revoked_at=None),
            SimpleNamespace(parent_id=uuid.uuid4(), chat_id=2, revoked_at=datetime.now(UTC)),
            SimpleNamespace(parent_id=uuid.uuid4(), chat_id=3, revoked_at=None),
        ]
        assert live_chats(links) == [1, 3]
