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
  return formatMeasured(kg);
}

/**
 * Любая величина, СНЯТАЯ ПРИБОРОМ: масса тела, кетоны, рост.
 *
 * Сохранённая точность без дописанных нулей — правило П45 для этого класса.
 * Показать взвешенные 8,25 кг как «8,3» значит потерять на экране то, что
 * измерили; дописать «3,50» к прочитанным на полоске 3,5 — наоборот, обещать
 * точность, которой не было.
 *
 * Одна реализация на все такие величины намеренно. До 18.09.2026 через неё шла
 * только масса тела, а кетоны печатались сырым числом — и «3.5 ммоль/л» через
 * точку стояло на главной семьи рядом с «18,16 кг» через запятую. Правило П45
 * кетоны называет прямо; не звал их только код.
 */
export function formatMeasured(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
    value,
  );
}

/**
 * Множитель порции: «1,5» и «1», без дописанных нулей.
 *
 * Не измерение и не масса — поэтому своё имя. В ките, а не на экране, по той же
 * причине, что и остальные: своё `Intl.NumberFormat` на месте однажды разойдётся
 * с соседним (два таких уже назывались `AMOUNT` и отличались точностью).
 */
export function formatFactor(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
    value,
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
