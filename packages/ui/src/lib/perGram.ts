/**
 * Пищевая ценность на 1 г (`docs/PLAN_PRODUCTS_PER_GRAM_2026-11.md`, вариант Б).
 *
 * Хранится и считается всё на 100 г, как в USDA и на этикетках: так ядро
 * расчёта, импорт и источники не меняются. Диетолог видит и вводит на 1 г, как
 * в KDC. Перевод живёт здесь один, и обе стороны точны: на 100 г в базе два
 * знака после запятой, значит на 1 г — не больше четырёх.
 */
import { formatLocale } from "./format";

/** Значение на 100 г → на 1 г. */
export function toPerGram(per100: number): number {
  return Math.round(per100 * 100) / 10_000;
}

/** Значение на 1 г → на 100 г, с точностью хранения (два знака). */
export function toPer100(perGram: number): number {
  return Math.round(perGram * 10_000) / 100;
}

/** Показ на 1 г: без потери знаков и без хвостовых нулей («0,825», «0,0365», «7,48»). */
export function formatPerGram(per100: number): string {
  return new Intl.NumberFormat(formatLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(toPerGram(per100));
}
