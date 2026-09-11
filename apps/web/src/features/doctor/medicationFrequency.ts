import type { Medication } from "./types";

export type MedicationFrequency = NonNullable<Medication["frequency_code"]>;

/**
 * Кратность приёма — как в перечислении сервера (`MedicationFrequency`,
 * ADR-0033). Порядок — порядок списка в форме: от редкого к частому, затем
 * то, что расписанием не описывается.
 *
 * Полноту списка держит связка тестов: `medicationFrequency.test.ts` сверяет его
 * со словарём, а тест API — словарь с подписями сервера.
 */
export const MEDICATION_FREQUENCIES = [
  "once_daily",
  "twice_daily",
  "three_times_daily",
  "four_times_daily",
  "every_other_day",
  "as_needed",
  "other",
] as const satisfies readonly MedicationFrequency[];

export function isMedicationFrequency(
  value: string,
): value is MedicationFrequency {
  return (MEDICATION_FREQUENCIES as readonly string[]).includes(value);
}

/**
 * «2 раза в сутки — утром и на ночь» — тем же правилом, что и отчёт сервера
 * (`api/services/medication_frequency.py`).
 *
 * У «другой схемы» подпись ничего не сообщает, поэтому показывается одно
 * уточнение. У записи, заведённой до списка, кода нет, и кратность целиком в
 * словах.
 */
export function describeFrequency(
  medication: Pick<Medication, "frequency_code" | "frequency">,
  labelOf: (code: MedicationFrequency) => string,
): string {
  const note = medication.frequency ?? "";
  const code = medication.frequency_code;
  if (code === null || code === undefined || code === "other") return note;
  return note === "" ? labelOf(code) : `${labelOf(code)} — ${note}`;
}
