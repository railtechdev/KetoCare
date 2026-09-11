"""Ключи повторной отправки стираются вместе с пациентом (ADR-0035)."""

from __future__ import annotations

from core.tools.erase_patient import patient_scoped_tables


def test_idempotency_keys_are_erased_with_the_patient():
    # В сохранённом ответе — данные ребёнка: блюдо, его состав и расчёт.
    # Таблица выводится из метаданных по колонке `patient_id`, и если её
    # когда-нибудь уберут, «стёрли» перестанет означать «стёрли всё».
    assert "idempotency_keys" in patient_scoped_tables()
