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
 * Масса тела в русской записи, без округления сотых.
 *
 * `weight_logs.weight_kg` хранится как `Numeric(5, 2)`, и показать взвешенные
 * 8,25 кг как «8,3» значит потерять на экране то, что измерили: по массе
 * считают калорийность и белок на килограмм. Нулей к целому не дописывает —
 * «18,00 кг» выглядит точнее, чем есть.
 *
 * Отдельно от `formatAmount` именно из-за этого: у макронутриентов один знак
 * нужен для сравнения соседних строк глазом, у массы тела важнее не соврать.
 */
export function formatWeight(kg: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
    kg,
  );
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
