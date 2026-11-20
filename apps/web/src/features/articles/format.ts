/**
 * Dates of the articles: «22.10.2026». The moment of a decision is a day for
 * a reader of the history; the time adds nothing to «who checked it and when».
 */
const DAY = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatArticleDay(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : DAY.format(date);
}

/** «Клиника, 22.10.2026» — the imported versions carry a label, not a person. */
export function personAndDay(
  name: string | null,
  at: string | null,
  unknown: string,
): string {
  const day = formatArticleDay(at);
  const who = name ?? unknown;
  return day === "" ? who : `${who}, ${day}`;
}
