/**
 * Кратность приёма препарата словами (ADR-0033).
 *
 * «2 раза в сутки — утром и на ночь» — тем же правилом, что и отчёт сервера
 * (`api/services/medication_frequency.py`). Живёт в ките: схему препаратов
 * читают и кабинет врача, и семья в Mini App («Лекарства сегодня»), и две
 * копии правила однажды разошлись бы в том, что видит врач и что видит семья.
 *
 * У «другой схемы» подпись ничего не сообщает, поэтому показывается одно
 * уточнение. У записи, заведённой до списка, кода нет, и кратность целиком в
 * словах. Подписи кодов — словарь приложения (`labelOf`).
 */
export function describeMedicationFrequency<Code extends string>(
  medication: {
    frequency_code?: Code | null;
    frequency?: string | null;
  },
  labelOf: (code: Exclude<Code, "other">) => string,
): string {
  const note = medication.frequency ?? "";
  const code = medication.frequency_code;
  if (code === null || code === undefined || code === "other") return note;
  const label = labelOf(code as Exclude<Code, "other">);
  return note === "" ? label : `${label} — ${note}`;
}

/** «По требованию» — расписания нет, пропустить приём нельзя (ADR-0033). */
export const AS_NEEDED_FREQUENCY = "as_needed";
