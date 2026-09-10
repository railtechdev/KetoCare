/** Форматирование значений дизайн-системы.
 *
 * Отдельно от компонентов: файл, экспортирующий и компонент, и функцию, ломает
 * гранулярность fast refresh, а сами функции нужны и без React (тесты, расчёты).
 */

/** Формат раздела 8.2 ТЗ: «3.9 : 1». */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(1)} : 1`;
}

/**
 * Число граммов, килограммов, миллимолей — в русской записи.
 *
 * `18.2` с точкой в русском интерфейсе читается как опечатка, а рядом с ним на
 * тех же экранах уже стоят числа с запятой (остаток до цели, итоги дня).
 * Одна функция на всех, иначе разделитель снова разойдётся между соседними
 * строками одного блока.
 */
export function formatAmount(value: number, digits = 1): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Дата и время записи дневника в локали пациента. */
export function formatOccurredAt(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
