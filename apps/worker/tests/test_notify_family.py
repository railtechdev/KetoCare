"""Текст уведомления о новом назначении (раздел 5.4 ТЗ).

Проверяется то, ради чего уведомление существует: цифры назначения в самом
сообщении. Доставка и обход привязок — отдельная история, здесь их нет.
"""

from __future__ import annotations

from worker.reminders.notify import _text

PRESCRIPTION = {
    "ratio": 3.5,
    "kcal_per_day": 1200,
    "protein_g": 24.0,
    "carbs_limit_g": 10.0,
}


class TestNoticeText:
    def test_names_the_numbers(self) -> None:
        """Иначе «назначение изменилось» заставляет открыть кабинет, чтобы
        понять, изменилось ли то, что важно прямо сейчас."""

        text = _text(PRESCRIPTION)

        assert "3.5:1" in text
        assert "1200" in text
        assert "24 г" in text
        assert "10 г" in text

    def test_ratio_is_written_the_way_the_family_knows_it(self) -> None:
        # «4:1», а не «4.0»: так соотношение записано и в кабинете, и в выписке.
        assert "4:1" in _text({**PRESCRIPTION, "ratio": 4.0})

    def test_says_the_menu_needs_recounting(self) -> None:
        # Без этого сообщение читается как справка, а не как повод действовать.
        assert "пересчитать" in _text(PRESCRIPTION)

    def test_carries_no_names(self) -> None:
        """Чат привязан к одному ребёнку — называть его по имени незачем."""

        assert "ребён" not in _text(PRESCRIPTION).lower()
