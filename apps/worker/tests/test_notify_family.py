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
