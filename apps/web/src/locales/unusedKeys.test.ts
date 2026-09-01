import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Ключи словарей, которых никто не читает.
 *
 * Это не про порядок ради порядка: неиспользуемая строка — вторая формулировка
 * правила, которая расходится с первой при первой же правке. Аудит поймал
 * ровно такой случай: «Меню доступно, когда выбран ребёнок» лежало в трёх
 * словарях, а показать его было нечем — выбор ребёнка давно вынесен в
 * `PatientGate`.
 *
 * Проверяются только листья верхнего и второго уровня: глубже ключи собираются
 * шаблоном (`t(`item.${kind}`)`), и статически такой поиск даёт ложные срабатывания.
 */
const LOCALES = join(__dirname, "ru");
const SOURCE = join(__dirname, "..");

function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "locales") collectSources(path, acc);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".test.tsx")
    ) {
      acc.push(readFileSync(path, "utf8"));
    }
  }
  return acc;
}

describe("словари", () => {
  it("не хранят строк, которых никто не показывает", () => {
    const sources = collectSources(SOURCE).join("\n");
    const unused: string[] = [];

    for (const file of readdirSync(LOCALES)) {
      const ns = file.replace(/\.json$/, "");
      const dict = JSON.parse(
        readFileSync(join(LOCALES, file), "utf8"),
      ) as Record<string, unknown>;

      for (const key of Object.keys(dict)) {
        // Ветвь словаря считается использованной, если упомянут сам ключ:
        // внутренние листья часто собираются шаблоном.
        if (!sources.includes(key)) unused.push(`${ns}:${key}`);
      }
    }

    expect(unused).toEqual([]);
  });
});
