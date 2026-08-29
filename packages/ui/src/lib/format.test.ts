// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatOccurredAt, formatRatio } from "./format";

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
