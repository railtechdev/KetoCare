/**
 * Что сказать о белке и углеводах блюда против цели приёма — одно на кабинет и
 * Mini App.
 *
 * Соотношение и калорийность эту раскладку не задают: блюдо держит обе при
 * двойном белке и почти без углеводов. Диетолог клиники 15.11.2026 получила
 * именно такое — 8,1 г белка и 0,8 г углеводов против цели 4,6 и 4,3 — под
 * строкой «Цель достигнута» (ADR-0083).
 *
 * Сошлась ли раскладка, решает сервер (`macro_fit.within_tolerance`, допуск —
 * константа ядра). Здесь только то, какими словами об этом сказать: что
 * назвать и чего в составе не хватает. Живёт в ките, а не в экране, по той же
 * причине, что `dayVerdict`: одна семья видит калькулятор в двух местах.
 */

export interface MacroFit {
  /** Факт минус цель, г; `null` — цели по белку нет */
  protein_delta_g: number | null;
  /** Факт минус цель, г; `null` — цели по чистым углеводам нет */
  net_carbs_delta_g: number | null;
  /**
   * Сколько граммов цели по углеводам не помещается в лимит углеводов
   * назначения: лимит считается вместе с клетчаткой, цель — без неё. Оба
   * расхождения выше уже посчитаны от того, что помещается.
   */
  carbs_limited_by_g?: number;
  within_tolerance: boolean;
}

export type MacroSplitPartKey =
  "proteinMore" | "proteinLess" | "carbsMore" | "carbsLess";

export interface MacroSplitPart {
  key: MacroSplitPartKey;
  /** Насколько мимо цели, г — всегда положительное */
  grams: number;
}

/**
 * Меньше этого расхождение печатается как «0,0 г»: называть его нечем.
 * Половина шага, с которым граммы стоят на экране (`formatGrams`).
 */
const PRINTABLE_G = 0.05;

/**
 * Расхождения, которые стоит назвать, — в порядке «белок, углеводы».
 *
 * Пусто, когда раскладка сошлась или цели нет: экран тогда молчит.
 */
export function macroSplitParts(
  fit: MacroFit | null | undefined,
): MacroSplitPart[] {
  if (fit === null || fit === undefined || fit.within_tolerance) return [];
  const parts: MacroSplitPart[] = [];
  const protein = fit.protein_delta_g;
  if (protein !== null && Math.abs(protein) >= PRINTABLE_G) {
    parts.push({
      key: protein > 0 ? "proteinMore" : "proteinLess",
      grams: Math.abs(protein),
    });
  }
  const carbs = fit.net_carbs_delta_g;
  if (carbs !== null && Math.abs(carbs) >= PRINTABLE_G) {
    parts.push({
      key: carbs > 0 ? "carbsMore" : "carbsLess",
      grams: Math.abs(carbs),
    });
  }
  return parts;
}

export type MacroSplitAdvice = "addCarbs" | "addProtein";

/**
 * Чего не хватает составу, из которого подбор раскладку собрать не смог.
 *
 * Спрашивать только про ответ ПОДБОРА: у него был весь диапазон масс, и раз он
 * не дотянулся — дело в продуктах, а не в граммах. Про состав, набранный
 * руками, тот же совет был бы ложью: там достаточно нажать «Подобрать».
 *
 * `null` — советовать нечего: раскладка сошлась, цели нет, либо обоих
 * нутриентов больше цели (тогда лишний продукт, а не недостающий).
 */
export function macroSplitAdvice(
  fit: MacroFit | null | undefined,
): MacroSplitAdvice | null {
  if (fit === null || fit === undefined || fit.within_tolerance) return null;
  const carbs = fit.net_carbs_delta_g;
  const protein = fit.protein_delta_g;
  // Наибольшая нехватка называется первой и единственной: совет «добавьте и
  // то, и другое» никого никуда не ведёт.
  const carbsShort = carbs !== null && carbs <= -PRINTABLE_G ? -carbs : 0;
  const proteinShort =
    protein !== null && protein <= -PRINTABLE_G ? -protein : 0;
  if (carbsShort === 0 && proteinShort === 0) return null;
  return carbsShort >= proteinShort ? "addCarbs" : "addProtein";
}

/**
 * На сколько граммов цель по углеводам снижена лимитом назначения — чтобы
 * сказать об этом словами.
 *
 * Без этой строки таблица «Факт / Цель» выглядела бы противоречием: углеводов
 * меньше цели, белка больше, а экран пишет «Цель достигнута». Лимит считает все
 * углеводы, цель — чистые, и клетчатка блюда занимает место под лимитом. Совет
 * «добавьте углеводы» здесь вывел бы день за лимит назначения.
 *
 * `null` — лимит цели не мешает или расхождение напечаталось бы нулём.
 */
export function macroSplitLimit(
  fit: MacroFit | null | undefined,
): number | null {
  const grams = fit?.carbs_limited_by_g ?? 0;
  return grams >= PRINTABLE_G ? grams : null;
}
