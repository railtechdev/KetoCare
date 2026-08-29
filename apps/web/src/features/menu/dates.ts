/**
 * Календарные операции над датой меню.
 *
 * Дата дня — строка `YYYY-MM-DD` (её принимает и возвращает API, раздел 5.3 ТЗ),
 * а не `Date`: у `Date` всегда есть время и зона, и день меню начал бы зависеть
 * от них. Все преобразования идут через локальные компоненты даты — семья
 * составляет день по своему календарю, а не по UTC.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Дата в формате `YYYY-MM-DD` по локальному календарю. */
export function toIsoDate(date: Date): string {
  // Не `toISOString()`: он переводит в UTC, и вечером в UTC+5 семья увидела бы
  // меню следующего дня.
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  // Проверка календарём: «2026-02-31» формату соответствует, а даты такой нет.
  return toIsoDate(parseIsoDate(value)) === value;
}

/** Дата, сдвинутая на `days` календарных суток. */
export function shiftIsoDate(value: string, days: number): string {
  const date = parseIsoDate(value);
  // setDate, а не «плюс 86 400 000 мс»: в сутках перевода часов не 24 часа,
  // и арифметика в миллисекундах давала бы соседний день дважды или пропуск.
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Подпись дня для заголовка: «пт, 28 августа 2026 г.». */
export function formatDayLabel(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parseIsoDate(value));
}

/** Множитель порции в локальном формате: 1,5 вместо 1.5. */
export function formatPortionFactor(factor: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
    factor,
  );
}

function parseIsoDate(value: string): Date {
  const match = ISO_DATE.exec(value);
  if (match === null) throw new Error(`Not an ISO date: ${value}`);
  // Локальная полночь: конструктор с компонентами не привязан к зоне UTC,
  // в отличие от `new Date("2026-08-28")`.
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
