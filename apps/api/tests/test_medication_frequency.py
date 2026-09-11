"""Кратность приёма словами: отчёт и кабинет называют её одинаково (ADR-0033).

Потребитель — карта пациента в кабинете (`apps/web/src/features/doctor`,
словарь `doctor.json`, ключ `medications.frequencyCodes`). Отчёт, CSV и PDF
собирает сервер, и словарей кабинета у него нет, поэтому слова записаны дважды.
Стык проверяется здесь, на стороне поставщика: разойдись они — врач читал бы в
отчёте одно, а в карте другое.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.medication_frequency import LABELS, describe_frequency
from core.models.enums import MedicationFrequency

REPO = Path(__file__).resolve().parents[3]
DOCTOR_RU = REPO / "apps/web/src/locales/ru/doctor.json"


class TestMedicationFrequencyLabels:
    def test_every_code_has_words(self):
        assert set(LABELS) == set(MedicationFrequency)

    def test_cabinet_uses_the_same_words(self):
        cabinet = json.loads(DOCTOR_RU.read_text(encoding="utf-8"))["medications"]["frequencyCodes"]

        assert cabinet == {code.value: label for code, label in LABELS.items()}


class TestDescribeFrequency:
    @pytest.mark.parametrize(
        ("code", "note", "expected"),
        [
            (MedicationFrequency.TWICE_DAILY, None, "2 раза в сутки"),
            (
                MedicationFrequency.TWICE_DAILY,
                "утром и на ночь",
                "2 раза в сутки — утром и на ночь",
            ),
            # У «другой схемы» подпись ничего не сообщает — печатаются слова.
            (MedicationFrequency.OTHER, "через два дня на третий", "через два дня на третий"),
            # Запись до списка: кратность целиком в словах.
            (None, "2 раза в день", "2 раза в день"),
        ],
    )
    def test_words(self, code, note, expected):
        assert describe_frequency(code, note) == expected
