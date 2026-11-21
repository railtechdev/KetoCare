/**
 * Срок приёма препарата словами — правило, общее для листа «Схема приёма
 * препаратов» в кабинете (ADR-0092) и экрана «Схема препаратов» в Mini App
 * (Р4 аудита Mini App 21.11.2026).
 *
 * Кит решает, КАКИЕ слова сказать и с какими датами; сами слова — словарь
 * приложения, даты — его формат. Дата окончания называется всегда, когда она
 * задана: без неё препарат, который врач уже отменяет, читался бы как
 * «принимать дальше».
 *
 * Даты — `YYYY-MM-DD`, сравниваются строкой.
 */
export interface MedicationDates {
  started_at: string;
  stopped_at?: string | null;
}

export type MedicationTerm =
  /** Принимается, конца не назначено. */
  | { key: "ongoing" }
  /** Принимается, последний день — `date`. */
  | { key: "until"; date: string }
  /** Начнётся `date`, конца не назначено. */
  | { key: "startsOn"; date: string }
  /** Начнётся `from`, последний день — `to`. */
  | { key: "startsUntil"; from: string; to: string };

export function medicationTerm(
  medication: MedicationDates,
  today: string,
): MedicationTerm {
  const starts = medication.started_at > today;
  const until = medication.stopped_at ?? null;
  if (until !== null) {
    return starts
      ? { key: "startsUntil", from: medication.started_at, to: until }
      : { key: "until", date: until };
  }
  return starts
    ? { key: "startsOn", date: medication.started_at }
    : { key: "ongoing" };
}

/**
 * Препараты схемы на сегодня и впереди — по алфавиту. Отменённые (последний
 * день раньше сегодняшнего) не показываются: схема — что давать, а не история.
 */
export function scheduledMedications<
  Medication extends MedicationDates & { drug_name: string },
>(items: readonly Medication[], today: string): Medication[] {
  return items
    .filter((item) => item.stopped_at == null || item.stopped_at >= today)
    .sort((a, b) => a.drug_name.localeCompare(b.drug_name, "ru"));
}
