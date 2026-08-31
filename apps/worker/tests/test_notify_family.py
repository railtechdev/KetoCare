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

    def test_sends_the_family_to_the_cabinet(self) -> None:
        """Без этого сообщение читается как справка, а не как повод действовать.

        Цифры лежат в кабинете — и только там их можно показать.
        """

        assert "кабинет" in NOTICE.lower()
        assert "пересчитать" in NOTICE.lower()

    def test_carries_no_names(self) -> None:
        """Чат привязан к одному ребёнку — называть его по имени незачем."""

        assert "ребён" not in NOTICE.lower()
