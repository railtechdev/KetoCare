import type { Medication } from "./types";

export type MedicationDoseUnit = NonNullable<Medication["dose_unit"]>;

/**
 * Единица разовой дозы — как в перечислении сервера (`MedicationDoseUnit`,
 * ADR-0049): единицы UCUM по образцу HL7 FHIR `doseQuantity`, затем штучные
 * формы и «другая единица», у которой доза пишется словами.
 *
 * Строку дозы для чтения («300 мг») собирает сервер — её же видят отчёт,
 * дневник и бот, поэтому своей сборки здесь нет. Полноту списка держит связка
 * тестов: `medicationDose.test.ts` сверяет его со словарём, а тест API —
 * словарь с подписями сервера.
 */
export const MEDICATION_DOSE_UNITS = [
  "mg",
  "g",
  "mcg",
  "ml",
  "iu",
  "drop",
  "tablet",
  "capsule",
  "sachet",
  "other",
] as const satisfies readonly MedicationDoseUnit[];

export function isMedicationDoseUnit(
  value: string,
): value is MedicationDoseUnit {
  return (MEDICATION_DOSE_UNITS as readonly string[]).includes(value);
}

/** Верхняя граница числа дозы — та же, что у сервера. */
export const DOSE_VALUE_MAX = 100_000;

/**
 * Число дозы из поля ввода: положительное, не больше трёх знаков после запятой
 * (`Numeric(10, 3)` на сервере). Запятая принимается наравне с точкой: врач
 * пишет «2,5». `null` — не число или вне границ.
 */
export function parseDoseValue(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 && value <= DOSE_VALUE_MAX ? value : null;
}
