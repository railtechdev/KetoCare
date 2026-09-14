import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * В ките `toFixed` разрешён ровно в одном месте — там, где число уходит в CSS.
 *
 * `width: 33,33%` браузер не поймёт: русская запись нужна человеку, а не
 * движку раскладки. Остальное идёт через `lib/format` (правило П45 канона).
 */
const ALLOWED = new Set([
  "components/MacroBar.tsx",
  // Сам источник помощников: там `toFixed` и живёт — у кетосоотношения
  // («3.9 : 1», формат раздела 8.2 ТЗ — пропорция, а не измерение).
  "lib/format.ts",
]);

describe("числа в ките", () => {
  it("пишутся помощниками lib/format, а не toFixed", () => {
    const root = join(import.meta.dirname);
    const guilty = globSync("**/*.{ts,tsx}", { cwd: root })
      .filter((file) => !file.includes(".test."))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) =>
        readFileSync(join(root, file), "utf8").includes(".toFixed("),
      );

    expect(guilty).toEqual([]);
  });

  it("исключение для CSS — ровно одно, и оно про ширину полосы", () => {
    const source = readFileSync(
      join(import.meta.dirname, "components/MacroBar.tsx"),
      "utf8",
    );
    const uses = source.match(/\.toFixed\(/g) ?? [];

    expect(uses).toHaveLength(1);
    expect(source).toContain("width: `${(share * 100).toFixed(2)}%`");
  });
});
