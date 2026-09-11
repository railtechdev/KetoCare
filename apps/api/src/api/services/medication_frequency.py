"""Кратность приёма препарата словами — для отчёта, CSV и PDF (ADR-0033).

Кабинет подписывает кратность своими словарями (`doctor.json`,
`medications.frequencyCodes`), а отчёт собирает сервер, и словарей у него нет.
Две записи одних и тех же слов сверяет тест
(`test_medication_frequency.py`): семья и врач не должны
читать в отчёте одно, а в карте другое.
"""

from __future__ import annotations

from core.models.enums import MedicationFrequency

LABELS: dict[MedicationFrequency, str] = {
    MedicationFrequency.ONCE_DAILY: "1 раз в сутки",
    MedicationFrequency.TWICE_DAILY: "2 раза в сутки",
    MedicationFrequency.THREE_TIMES_DAILY: "3 раза в сутки",
    MedicationFrequency.FOUR_TIMES_DAILY: "4 раза в сутки",
    MedicationFrequency.EVERY_OTHER_DAY: "Через день",
    MedicationFrequency.AS_NEEDED: "По требованию",
    MedicationFrequency.OTHER: "Другая схема",
}


def describe_frequency(code: MedicationFrequency | None, note: str | None) -> str:
    """«2 раза в сутки — утром и на ночь».

    У «другой схемы» сама подпись ничего не сообщает, поэтому печатается одно
    уточнение. У записи до списка кода нет, и кратность целиком — в уточнении.
    """

    if code is None or code is MedicationFrequency.OTHER:
        return note or ""
    label = LABELS[code]
    return f"{label} — {note}" if note else label
