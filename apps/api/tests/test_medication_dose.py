"""Доза словами: отчёт и кабинет называют единицу одинаково (ADR-0049).

Потребитель — форма назначения препарата в кабинете
(`apps/web/src/features/doctor/MedicationForm.tsx`, словарь `doctor.json`,
ключ `medications.doseUnits`): врач выбирает единицу по этой подписи. Строку
дозы для отчёта, дневника и бота собирает сервер, и словарей кабинета у него
нет, поэтому подписи записаны дважды. Разойдись они — врач выбрал бы «мкг», а в
отчёте прочёл бы другое.
"""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

from api.services.medication_dose import LABELS, describe_dose, format_dose_value
from core.models.enums import MedicationDoseUnit

REPO = Path(__file__).resolve().parents[3]
DOCTOR_RU = REPO / "apps/web/src/locales/ru/doctor.json"


class TestDoseUnitLabels:
    def test_every_unit_has_words(self):
        assert set(LABELS) == set(MedicationDoseUnit)

    def test_cabinet_uses_the_same_words(self):
        cabinet = json.loads(DOCTOR_RU.read_text(encoding="utf-8"))["medications"]["doseUnits"]

        assert cabinet == {unit.value: label for unit, label in LABELS.items()}


class TestDescribeDose:
    @pytest.mark.parametrize(
        ("value", "unit", "text", "expected"),
        [
            (300, MedicationDoseUnit.MG, None, "300 мг"),
            (Decimal("2.500"), MedicationDoseUnit.ML, None, "2,5 мл"),
            (0.5, MedicationDoseUnit.TABLET, None, "0,5 табл."),
            (Decimal("12500.000"), MedicationDoseUnit.IU, None, "12 500 МЕ"),
            # У «другой единицы» и у записи до списка доза — слова.
            (None, MedicationDoseUnit.OTHER, "2,5 мг/кг/сут", "2,5 мг/кг/сут"),
            (None, None, "300 мг", "300 мг"),
        ],
    )
    def test_words(self, value, unit, text, expected):
        assert describe_dose(value, unit, text) == expected

    def test_value_keeps_three_digits_without_trailing_zeros(self):
        assert format_dose_value(Decimal("0.125")) == "0,125"
        assert format_dose_value(10.0) == "10"
