"""Доза препарата словами — для карты, отчёта, дневника и бота (ADR-0049).

Доза задаётся числом и единицей из списка (вопрос 44), а читают её строкой
«300 мг». Строку собирает одна эта функция при записи, и она хранится в
`medications.dose`: все, кто дозу только показывает, — отчёт, сводка врача,
дневник семьи, бот, — продолжают читать одно поле и о способе записи не знают.

Подписи единиц записаны дважды — здесь и в словаре кабинета (`doctor.json`,
`medications.doseUnits`), где по ним выбирают единицу. Сверяет их
`test_medication_dose.py`: врач не должен выбрать «мкг», а прочесть в отчёте
другое слово.
"""

from __future__ import annotations

from decimal import Decimal

from core.models.enums import MedicationDoseUnit

#: Сокращения — принятые в рецептах: у «табл.», «капс.», «кап.» нет склонения,
#: и «0,5 табл.» читается так же правильно, как «2 табл.».
LABELS: dict[MedicationDoseUnit, str] = {
    MedicationDoseUnit.MG: "мг",
    MedicationDoseUnit.G: "г",
    MedicationDoseUnit.MCG: "мкг",
    MedicationDoseUnit.ML: "мл",
    MedicationDoseUnit.IU: "МЕ",
    MedicationDoseUnit.DROP: "кап.",
    MedicationDoseUnit.TABLET: "табл.",
    MedicationDoseUnit.CAPSULE: "капс.",
    MedicationDoseUnit.SACHET: "саше",
    MedicationDoseUnit.OTHER: "другая единица",
}


def format_dose_value(value: float | Decimal) -> str:
    """Число в русской записи без дописанных нулей: «2,5», «0,125», «1 000».

    Правило П45 канона: запятая, пробел между разрядами (неразрывный), а
    точность — та, что записана, не больше трёх знаков (`Numeric(10, 3)`).
    """

    quantized = Decimal(str(value)).quantize(Decimal("0.001"))
    whole, _, fraction = f"{quantized:,.3f}".partition(".")
    fraction = fraction.rstrip("0")
    whole = whole.replace(",", " ")
    return f"{whole},{fraction}" if fraction else whole


def describe_dose(
    value: float | Decimal | None, unit: MedicationDoseUnit | None, text: str | None
) -> str:
    """«300 мг», «0,5 табл.» — или слова врача.

    У «другой единицы» и у записи до списка числа нет, и доза — это слова.
    """

    if unit is None or unit is MedicationDoseUnit.OTHER or value is None:
        return text or ""
    return f"{format_dose_value(value)} {LABELS[unit]}"
