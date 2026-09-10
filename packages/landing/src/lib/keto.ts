/**
 * Расчёт для ДЕМОНСТРАЦИОННОГО калькулятора на лендинге.
 *
 * Это не расчётное ядро продукта: настоящие расчёты выполняет
 * `packages/keto_engine`, изолированный и покрытый эталонными тестами
 * медицинской команды. Здесь — иллюстрация формулы на четырёх продуктах,
 * и клинических решений по ней принимать нельзя.
 *
 * Формула кетосоотношения совпадает с ядром: R = F / (P + Cnet), где Cnet —
 * углеводы за вычетом клетчатки, по каждому продукту и не в минус (ADR-0030).
 * TARGET_RATIO и TOLERANCE держатся в согласии с `keto_engine/constants.py`
 * (`RATIO_TOLERANCE = 0.15`, помечена там как ожидающая подтверждения
 * медицинской командой). Меняется там — меняется и здесь.
 *
 * Обещание «меняется там — меняется и здесь» однажды не сработало: ядро
 * перешло на чистые углеводы, а страница осталась на общих и на тех же
 * граммовках показывала 3,54 и «в допуске» там, где продукт давал 3,78 и
 * «выше назначения». Публичная страница про клинический расчёт спорила с самим
 * расчётом.
 *
 * Теперь дрейф закрыт с двух сторон, и обе нужны:
 *
 * - `keto.test.ts` рядом проверяет саму эту ФОРМУЛУ (клетчатка выходит из
 *   знаменателя, зажим по каждому продукту, вердикт на граммовках по
 *   умолчанию);
 * - `packages/keto_engine/tests/test_public_demo_matches_engine.py` проверяет
 *   ЧИСЛА — прогоняет `demo-dish.json` через настоящее ядро.
 *
 * Первый тест не увидит смены медицинского правила, второй не увидит правки
 * этого файла.
 *
 * Одни и те же функции считают и на сборке (значения по умолчанию попадают
 * в HTML), и в браузере при движении ползунков. Поэтому страница без
 * JavaScript показывает корректный расчёт, а не пустые прочерки.
 */

import demo from "./demo-dish.json";

export interface Ingredient {
  /** Граммы жиров, белков, углеводов и ккал на 100 г. Источник — USDA
   *  FoodData Central, те же значения, что в `infra/scripts/seed_demo.py`. */
  fat: number;
  protein: number;
  carbs: number;
  /** Клетчатка на 100 г: входит в `carbs`, но не в знаменатель соотношения. */
  fiber: number;
  kcal: number;
  /** Верхняя граница ползунка, г. */
  max: number;
  /** Значение по умолчанию, г. */
  initial: number;
}

/*
 * Граммовки по умолчанию подобраны так, чтобы блюдо СРАЗУ попадало в
 * назначение: 3,54 : 1 при 346 ккал. Раздел называется «Соберите завтрак под
 * назначение 3,5 : 1», и открывать его красной надписью «ниже назначения»
 * — значит показывать посетителю поломку вместо примера.
 *
 * Масло уменьшено с 25 до 22 г вместе с переходом на чистые углеводы: клетчатка
 * брокколи вышла из знаменателя, соотношение на прежних граммовках поднялось до
 * 3,78 — за допуск.
 */
export const INGREDIENTS: Ingredient[] = demo.ingredients;

export const TARGET_RATIO = demo.target_ratio;
export const TOLERANCE = 0.15;

export interface CalcResult {
  fat: number;
  protein: number;
  carbs: number;
  /** Углеводы за вычетом клетчатки — по ним считается соотношение. */
  netCarbs: number;
  kcal: number;
  ratio: number;
  /** Доли для полосы макронутриентов, проценты. */
  fatPct: number;
  proteinPct: number;
  carbsPct: number;
  state: "ok" | "low" | "high";
}

/**
 * Расчёт по произвольному набору продуктов.
 *
 * Набор параметром, а не из модуля, ровно ради проверяемости: в демо-наборе нет
 * продукта, у которого клетчатки больше углеводов, и на нём зажим по каждому
 * продукту неотличим от зажима по блюду целиком — тест на него ничего бы не
 * различал. Страница зовёт `calculate`, тест подставляет синтетический продукт.
 */
export function calculateFrom(
  ingredients: readonly Ingredient[],
  grams: number[],
): CalcResult {
  let fat = 0;
  let protein = 0;
  let carbs = 0;
  let netCarbs = 0;
  let kcal = 0;

  ingredients.forEach((ing, i) => {
    const g = grams[i] ?? 0;
    fat += (g * ing.fat) / 100;
    protein += (g * ing.protein) / 100;
    carbs += (g * ing.carbs) / 100;
    // Зажим стоит у КАЖДОГО продукта, как в ядре: клетчатка одного не должна
    // гасить углеводы другого.
    netCarbs += Math.max((g * (ing.carbs - ing.fiber)) / 100, 0);
    kcal += (g * ing.kcal) / 100;
  });

  const denominator = protein + netCarbs;
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
    netCarbs,
    kcal,
    ratio,
    fatPct: (fat / total) * 100,
    proteinPct: (protein / total) * 100,
    carbsPct: (carbs / total) * 100,
    state,
  };
}

/** Расчёт по продуктам страницы — то, что зовут виджет и сборка. */
export function calculate(grams: number[]): CalcResult {
  return calculateFrom(INGREDIENTS, grams);
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
