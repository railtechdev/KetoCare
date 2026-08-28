/** Форматирование значений дизайн-системы.
 *
 * Отдельно от компонентов: файл, экспортирующий и компонент, и функцию, ломает
 * гранулярность fast refresh, а сами функции нужны и без React (тесты, расчёты).
 */

/** Формат раздела 8.2 ТЗ: «3.9 : 1». */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(1)} : 1`;
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
