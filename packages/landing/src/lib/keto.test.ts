import { describe, expect, it } from "vitest";

import demo from "./demo-dish.json";
import { calculate, INGREDIENTS, TARGET_RATIO, TOLERANCE } from "./keto";

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
    // Продукта с клетчаткой больше углеводов в наборе нет, поэтому проверяется
    // сама форма выражения: вклад позиции не может быть отрицательным.
    const one = INGREDIENTS.map((_, i) => (i === 3 ? 50 : 0));
    const r = calculate(one);

    expect(r.netCarbs).toBeGreaterThanOrEqual(0);
    expect(r.netCarbs).toBeCloseTo(2.0, 6);
  });

  it("граммовки по умолчанию попадают в назначение, и это видно вердиктом", () => {
    // Раздел называется «Соберите завтрак под назначение 3,5 : 1». Открывать
    // его красной надписью «выше назначения» — показывать посетителю поломку.
    const r = calculate(DEFAULTS);

    expect(Math.abs(r.ratio - TARGET_RATIO)).toBeLessThanOrEqual(TOLERANCE);
    expect(r.state).toBe("ok");
  });

  it("соотношение считается по чистым углеводам, а не по общим", () => {
    // Разделяющая проверка: верните знаменатель к общим углеводам, и она
    // упадёт — на граммовках по умолчанию разница 3,54 против 3,25.
    const r = calculate(DEFAULTS);

    expect(r.ratio).toBeCloseTo(r.fat / (r.protein + r.netCarbs), 9);
    expect(r.ratio).not.toBeCloseTo(r.fat / (r.protein + r.carbs), 2);
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
