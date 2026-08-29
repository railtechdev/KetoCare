/**
 * Форматирование чисел рецепта.
 *
 * Отдельно от компонентов: файл, экспортирующий и компонент, и функцию, ломает
 * гранулярность fast refresh.
 */

const GRAMS = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/**
 * Масса в граммах.
 *
 * Округление до десятых, а не до целых: состав хранится с точностью до 0.1 г,
 * и округлённые массы не сложились бы в заявленный выход рецепта.
 */
export function formatGrams(value: number): string {
  return GRAMS.format(value);
}
