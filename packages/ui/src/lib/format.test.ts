// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  formatGrams,
  formatKcal,
  formatMass,
  formatNumber,
  formatOccurredAt,
  formatRatio,
  formatWeight,
} from "./format";

describe("formatRatio", () => {
  it("форматирует по разделу 8.2 ТЗ: «3.9 : 1»", () => {
    expect(formatRatio(3.87)).toBe("3.9 : 1");
    expect(formatRatio(4)).toBe("4.0 : 1");
  });

  it("округляет до одного знака, а не отбрасывает", () => {
    expect(formatRatio(3.96)).toBe("4.0 : 1");
  });
});

describe("formatOccurredAt", () => {
  it("выводит дату и время в русской локали", () => {
    const formatted = formatOccurredAt(new Date("2026-03-14T09:05:00Z"));
    expect(formatted).toMatch(/^\d{2}\.\d{2}\.\d{4}/);
  });
});

describe("formatWeight", () => {
  it("не округляет сотые: масса тела — измерение, а не оценка", () => {
    // `weight_logs.weight_kg` — Numeric(5, 2). Показать 8,25 кг как «8,3»
    // значит потерять на экране то, что взвесили: по массе считают
    // калорийность и белок на килограмм.
    expect(formatWeight(8.25)).toBe("8,25");
    expect(formatWeight(18.2)).toBe("18,2");
  });

  it("не дописывает нули к целому", () => {
    // «18,00 кг» выглядит точнее, чем есть: взвесили ровно 18.
    expect(formatWeight(18)).toBe("18");
  });
});

describe("запись чисел (правило П45)", () => {
  it("сравниваемые граммы держат знак после запятой", () => {
    // «50,0» рядом с «4,5» читается как пара чисел, «50» — как разнобой.
    expect(formatGrams(50)).toBe("50,0");
    expect(formatGrams(4.53)).toBe("4,5");
  });

  it("читаемые граммы не дописывают нулей", () => {
    expect(formatMass(50)).toBe("50");
    expect(formatMass(12.34)).toBe("12,3");
  });

  it("калорийность идёт с русским разделителем разрядов", () => {
    // «1200 ккал» читается хуже, чем «1 200»; суточная норма четырёхзначная.
    // Разделитель — неразрывный пробел, и какой именно (U+00A0 или U+202F),
    // решает ICU той среды, где собирают: сверяется форма, а не байт.
    expect(formatKcal(1200)).toMatch(/^1[\s\u00a0\u202f]200$/u);
    expect(formatKcal(412.6)).toBe("413");
  });

  it("дробная часть отделяется запятой, а не точкой", () => {
    // Ради этого правило и заведено: toFixed возвращает английскую запись, и
    // «4.0 г» оказывалось рядом с «4,0 г» из соседнего блока.
    for (const written of [
      formatGrams(4),
      formatMass(4.2),
      formatNumber(4, 2),
    ]) {
      expect(written).not.toContain(".");
    }
  });

  it("кетосоотношение остаётся английским намеренно", () => {
    // Это пропорция из раздела 8.2 ТЗ, а не измерение.
    expect(formatRatio(3.9)).toBe("3.9 : 1");
  });
});
