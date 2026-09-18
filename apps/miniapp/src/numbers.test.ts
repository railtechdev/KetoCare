import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * То же правило П45, что и в кабинете, и проверка своя: экран один и тот же
 * человек видит в двух приложениях, и «12.3 г» в одном рядом с «12,3 г» в
 * другом — это разнобой про здоровье его ребёнка.
 */
describe("числа в Mini App", () => {
  it("пишутся помощниками кита, а не toFixed", () => {
    const root = join(import.meta.dirname);
    const guilty = globSync("**/*.{ts,tsx}", { cwd: root })
      .filter((file) => !file.includes(".test."))
      .filter((file) =>
        readFileSync(join(root, file), "utf8").includes(".toFixed("),
      );

    expect(
      guilty,
      "используйте formatGrams / formatMass / formatKcal из @ketocare/ui",
    ).toEqual([]);
  });

  it("не заводят своего Intl.NumberFormat мимо кита", () => {
    // Тот же довод, что в кабинете: русская запись получилась бы, а правило
    // точности жило бы копией — и разошлось бы с кабинетом молча.
    const root = join(import.meta.dirname);
    const guilty = globSync("**/*.{ts,tsx}", { cwd: root })
      .filter((file) => !file.includes(".test."))
      .filter((file) =>
        readFileSync(join(root, file), "utf8").includes(
          "new Intl.NumberFormat",
        ),
      );

    expect(
      guilty,
      "правило точности живёт в packages/ui/src/lib/format.ts",
    ).toEqual([]);
  });
});
