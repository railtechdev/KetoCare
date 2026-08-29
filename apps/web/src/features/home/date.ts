/**
 * Дата сводки приходит без времени: это местные сутки установки (`settings.tz`
 * на сервере), а не UTC-дата.
 *
 * Поэтому строка разбирается по частям, а не через `new Date("2026-08-28")`:
 * такая запись трактуется как полночь UTC, и западнее Гринвича подпись сводки
 * съехала бы на вчерашнее число — родитель решил бы, что смотрит вчерашний день.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Подпись даты сводки, напр. «28 августа 2026 г.». */
export function formatOverviewDate(value: string): string | null {
  const date = parseIsoDate(value);
  if (date === null) return null;

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
