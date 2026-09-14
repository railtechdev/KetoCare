import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Правило П45 канона исполняемое, а не только записанное.
 *
 * `toFixed` возвращает строку в английской записи, и «4.0 г» из `MacroBar`
 * оказывалось рядом с «4,0 г» из итогов дня — в одном блоке, про одно и то же.
 * Правило без проверки не выполняется даже автором в тот же день: это уже
 * показали заголовки безопасности и работа по раскладке.
 */
export function filesWithToFixed(root: string): string[] {
  return globSync("**/*.{ts,tsx}", { cwd: root })
    .filter((file) => !file.includes(".test."))
    .filter((file) =>
      readFileSync(join(root, file), "utf8").includes(".toFixed("),
    );
}

describe("числа на экранах кабинета", () => {
  it("пишутся помощниками кита, а не toFixed", () => {
    const guilty = filesWithToFixed(join(import.meta.dirname));

    expect(
      guilty,
      "используйте formatGrams / formatMass / formatKcal из @ketocare/ui",
    ).toEqual([]);
  });
});
