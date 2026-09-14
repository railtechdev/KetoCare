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

/**
 * Число в русской записи с заданным знаком после запятой.
 *
 * Основание для всех остальных: `toFixed` возвращает английскую запись, и
 * «4.0 г» оказывалось рядом с «4,0 г» из соседнего блока — про одно и то же
 * (правило П45 канона).
 */
export function formatNumber(value: number, digits: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Граммы, которые СРАВНИВАЮТ: жиры, белки, углеводы в строке, итоги рядом с
 * целью.
 *
 * Знак после запятой всегда, даже нулевой: «50,0» рядом с «4,5» читается как
 * пара чисел, «50» рядом с «4,5» — как разнобой.
 */
export function formatGrams(value: number): string {
  return formatNumber(value, 1);
}

/**
 * Граммы, которые ЧИТАЮТ: масса продукта в составе, граммовка в плане дня.
 *
 * Целые остаются целыми — «50 г масла» не нуждается в нуле после запятой, а
 * список того, что взвесить, читают по одной строке, а не столбцом.
 */
export function formatMass(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(
    value,
  );
}

/**
 * Калорийность: целое число с русским разделителем разрядов.
 *
 * Суточная норма — четырёхзначная, и «1200 ккал» читается хуже, чем «1 200».
 */
export function formatKcal(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(
    value,
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
