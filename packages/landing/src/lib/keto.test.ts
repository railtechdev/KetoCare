import { describe, expect, it } from "vitest";

import demo from "./demo-dish.json";
import {
  calculate,
  calculateFrom,
  INGREDIENTS,
  TARGET_RATIO,
  TOLERANCE,
  type Ingredient,
} from "./keto";

const DEFAULTS = INGREDIENTS.map((ing) => ing.initial);

/**
 * Формула демо-калькулятора обязана совпадать с расчётным ядром.
 *
 * Числа сверяет `packages/keto_engine/tests/test_public_demo_matches_engine.py`
 * — он прогоняет `demo-dish.json` через настоящее ядро. Но числа и реализация
 * — разные вещи: исходный дефект был дрейфом ФОРМУЛЫ (страница осталась на
 * общих углеводах, когда ядро перешло на чистые), и тот тест его бы не поймал:
 * он этот файл не читает.
 *
 * Здесь проверяется сама `calculate()`. Вместе эти два теста закрывают оба
 * направления дрейфа.
 */
describe("расчёт демо-калькулятора", () => {
  it("вычитает клетчатку из знаменателя", () => {
    // Только брокколи, 100 г: 6,6 г углеводов и 2,6 г клетчатки.
    const only = INGREDIENTS.map((_, i) => (i === 3 ? 100 : 0));
    const r = calculate(only);

    expect(r.carbs).toBeCloseTo(6.6, 6);
    expect(r.netCarbs).toBeCloseTo(4.0, 6);
    // По общим углеводам вышло бы 0.4 / (2.8 + 6.6) = 0.0426.
    expect(r.ratio).toBeCloseTo(0.4 / (2.8 + 4.0), 6);
  });

  it("зажимает клетчатку по каждому продукту, а не по блюду", () => {
    // На продуктах страницы оба способа совпадают: ни у одного клетчатки не
    // больше углеводов. Поэтому набор здесь синтетический — иначе тест назывался
    // бы одним, а проверял другое.
    //
    // По продуктам: 0 + 4 = 4 г чистых, соотношение 10 / (1 + 4) = 2.
    // По блюду целиком: 7,6 − 7,6 = 0, соотношение 10 / 1 = 10. Разница впятеро.
    const odd: Ingredient = {
      fat: 10,
      protein: 1,
      carbs: 1,
      fiber: 5,
      kcal: 0,
      max: 100,
      initial: 100,
    };
    const veg: Ingredient = {
      fat: 0,
      protein: 0,
      carbs: 6.6,
      fiber: 2.6,
      kcal: 34,
      max: 100,
      initial: 100,
    };

    const r = calculateFrom([odd, veg], [100, 100]);

    expect(r.carbs).toBeCloseTo(7.6, 6);
    expect(r.netCarbs).toBeCloseTo(4.0, 6);
    expect(r.ratio).toBeCloseTo(2.0, 6);
  });

  it("вклад продукта в чистые углеводы не уходит в минус", () => {
    const odd: Ingredient = {
      fat: 10,
      protein: 1,
      carbs: 1,
      fiber: 5,
      kcal: 0,
      max: 100,
      initial: 100,
    };

    const r = calculateFrom([odd], [100]);

    expect(r.netCarbs).toBeCloseTo(0, 6);
    expect(r.ratio).toBeCloseTo(10.0, 6);
  });

  it("граммовки по умолчанию попадают в назначение, и это видно вердиктом", () => {
    // Раздел называется «Соберите завтрак под назначение 3,5 : 1». Открывать
    // его красной надписью «выше назначения» — показывать посетителю поломку.
    const r = calculate(DEFAULTS);

    expect(Math.abs(r.ratio - TARGET_RATIO)).toBeLessThanOrEqual(TOLERANCE);
    expect(r.state).toBe("ok");
  });

  it("соотношение считается по чистым углеводам, а не по общим", () => {
    // Сверять соотношение с `fat / (protein + netCarbs)` бессмысленно: это
    // функция против самой себя. Различает вторая строка — по общим углеводам
    // на тех же граммовках вышло бы заметно меньше.
    const r = calculate(DEFAULTS);

    expect(r.ratio).not.toBeCloseTo(r.fat / (r.protein + r.carbs), 2);
    expect(r.ratio).toBeGreaterThan(r.fat / (r.protein + r.carbs));
  });

  it("блюдо выше назначения показывается как выше, а не как в допуске", () => {
    // Публичный дефект, с которого всё началось, был именно таким: страница
    // называла «в допуске» блюдо, которое продукт считал вне его. Вердикт,
    // закреплённый только с зелёной стороны, этого не ловит.
    const fatty = INGREDIENTS.map((ing, i) => (i === 2 ? ing.max : 0));
    const r = calculate(fatty);

    expect(r.ratio).toBeGreaterThan(TARGET_RATIO + TOLERANCE);
    expect(r.state).toBe("high");
  });

  it("блюдо ниже назначения показывается как ниже", () => {
    const lean = INGREDIENTS.map((ing, i) => (i === 0 ? ing.max : 0));
    const r = calculate(lean);

    expect(r.ratio).toBeLessThan(TARGET_RATIO - TOLERANCE);
    expect(r.state).toBe("low");
  });

  it("нулевой состав не делит на ноль", () => {
    const r = calculate(INGREDIENTS.map(() => 0));

    expect(r.ratio).toBe(0);
    expect(Number.isFinite(r.fatPct)).toBe(true);
  });

  it("читает продукты из общего файла, а не из своей копии", () => {
    // Копия здесь означала бы, что python-тест сверяет с ядром одни числа, а
    // страница показывает другие.
    expect(INGREDIENTS).toEqual(demo.ingredients);
    expect(TARGET_RATIO).toBe(demo.target_ratio);
  });
});
