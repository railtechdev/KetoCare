/**
 * Короткое имя источника для колонки справочника.
 *
 * В строке продукта лежит полное имя источника, как его записал импорт или
 * сборка справочника: «USDA FoodData Central SR Legacy», «Лечебное питание,
 * Нестеренко В. И. (2011)», а у собранной строки — «Слияние: A + B». В узкой
 * колонке это обрезалось на середине слова («USDA FoodData C…»), и прочитать,
 * откуда число, было нельзя. Полный текст остаётся во всплывающей подсказке.
 *
 * Правило одно на все случаи: первая часть до запятой, скобки или точки с
 * запятой, не длиннее трёх слов. Имя источника из перечня источников
 * сокращается так же — колонка и перечень называют его одинаково.
 */

/** Сколько слов оставлять: «USDA FoodData Central», «Лечебное питание». */
const MAX_WORDS = 3;

/** Подпись строки, собранной из нескольких источников (сервер, ADR-0068). */
const MERGE_PREFIX = /^Слияние:\s*/;

export function shortSourceName(source: string): string {
  const trimmed = source.trim();
  if (MERGE_PREFIX.test(trimmed)) {
    return trimmed
      .replace(MERGE_PREFIX, "")
      .split(" + ")
      .map(shortOne)
      .filter((part) => part !== "")
      .join(" + ");
  }
  return shortOne(trimmed);
}

function shortOne(name: string): string {
  const head = name.split(/[,;(]/, 1)[0]?.trim() ?? "";
  const words = head.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return name.trim();
  return words.slice(0, MAX_WORDS).join(" ");
}
