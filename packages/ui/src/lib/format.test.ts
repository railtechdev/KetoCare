// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatOccurredAt, formatRatio, formatWeight } from "./format";

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
