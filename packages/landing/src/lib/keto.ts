/**
 * Расчёт для ДЕМОНСТРАЦИОННОГО калькулятора на лендинге.
 *
 * Это не расчётное ядро продукта: настоящие расчёты выполняет
 * `packages/keto_engine`, изолированный и покрытый эталонными тестами
 * медицинской команды. Здесь — иллюстрация формулы на четырёх продуктах,
 * и клинических решений по ней принимать нельзя.
 *
 * Формула кетосоотношения совпадает с ядром: R = F / (P + C).
 * TARGET_RATIO и TOLERANCE держатся в согласии с `keto_engine/constants.py`
 * (`RATIO_TOLERANCE = 0.15`, помечена там как ожидающая подтверждения
 * медицинской командой). Меняется там — меняется и здесь.
 *
 * Одни и те же функции считают и на сборке (значения по умолчанию попадают
 * в HTML), и в браузере при движении ползунков. Поэтому страница без
 * JavaScript показывает корректный расчёт, а не пустые прочерки.
 */

export interface Ingredient {
  /** Граммы жиров, белков, углеводов и ккал на 100 г. Источник — USDA
   *  FoodData Central, те же значения, что в `infra/scripts/seed_demo.py`. */
  fat: number;
  protein: number;
  carbs: number;
  kcal: number;
  /** Верхняя граница ползунка, г. */
  max: number;
  /** Значение по умолчанию, г. */
  initial: number;
}

/*
 * Граммовки по умолчанию подобраны так, чтобы блюдо СРАЗУ попадало в
 * назначение: 3,54 : 1 при 368 ккал. Раздел называется «Соберите завтрак под
 * назначение 3,5 : 1», и открывать его красной надписью «ниже назначения»
 * — значит показывать посетителю поломку вместо примера.
 */
export const INGREDIENTS: Ingredient[] = [
  { fat: 10.6, protein: 12.6, carbs: 1.1, kcal: 155, max: 110, initial: 40 },
  { fat: 33.0, protein: 2.5, carbs: 3.6, kcal: 337, max: 90, initial: 35 },
  { fat: 81.1, protein: 0.9, carbs: 0.1, kcal: 717, max: 60, initial: 25 },
  { fat: 0.4, protein: 2.8, carbs: 6.6, kcal: 34, max: 90, initial: 25 },
];

export const TARGET_RATIO = 3.5;
export const TOLERANCE = 0.15;

export interface CalcResult {
  fat: number;
  protein: number;
  carbs: number;
  kcal: number;
  ratio: number;
  /** Доли для полосы макронутриентов, проценты. */
  fatPct: number;
  proteinPct: number;
  carbsPct: number;
  state: "ok" | "low" | "high";
}

export function calculate(grams: number[]): CalcResult {
  let fat = 0;
  let protein = 0;
  let carbs = 0;
  let kcal = 0;

  INGREDIENTS.forEach((ing, i) => {
    const g = grams[i] ?? 0;
    fat += (g * ing.fat) / 100;
    protein += (g * ing.protein) / 100;
    carbs += (g * ing.carbs) / 100;
    kcal += (g * ing.kcal) / 100;
  });

  const denominator = protein + carbs;
  const ratio = denominator > 0 ? fat / denominator : 0;
  // Защита от деления на ноль, когда все ползунки в нуле.
  const total = Math.max(fat + protein + carbs, 0.001);

  const state: CalcResult["state"] =
    ratio < TARGET_RATIO - TOLERANCE
      ? "low"
      : ratio > TARGET_RATIO + TOLERANCE
        ? "high"
        : "ok";

  return {
    fat,
    protein,
    carbs,
    kcal,
    ratio,
    fatPct: (fat / total) * 100,
    proteinPct: (protein / total) * 100,
    carbsPct: (carbs / total) * 100,
    state,
  };
}

/**
 * Десятичный разделитель зависит от языка: в русском и узбекском — запятая,
 * в английском — точка. Числа на странице должны выглядеть привычно, иначе
 * «3.5 : 1» читается как опечатка.
 */
export function formatNumber(
  value: number,
  locale: string,
  digits = 1,
): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}
