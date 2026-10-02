import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { rawNumbersNextToUnits } from "@ketocare/ui/testing";

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
  it("не подставляют сырое число рядом с единицей измерения", () => {
    // Третий способ показать сырое число, мимо обеих проверок выше: единица
    // измерения стоит в шаблоне словаря, а вызов подставляет в него поле ответа
    // как есть. Так «1200 ккал в сутки» стояло в одной строке с «1 200 ккал»
    // из соседнего блока, а дробный рост печатался как «120.5 см».
    const guilty = rawNumbersNextToUnits({
      localesDir: join(import.meta.dirname, "locales/ru"),
      sourceDir: join(import.meta.dirname),
    }).map(
      (found) =>
        `${found.file}:${found.line} ${found.key} → ${found.variable}: ${found.expression}`,
    );

    expect(
      guilty,
      "оберните значение помощником кита (formatGrams / formatKcal / formatMass / formatMeasured)",
    ).toEqual([]);
  });
  it("не зовут проверку словарей из рантайма", () => {
    // `@ketocare/ui/testing` читает файловую систему (`node:fs`). Сегодня он
    // виден только тестам, но публичный вход у пакета есть, и импорт из экранного
    // кода сломался бы на сборке, а не на ревью.
    const root = join(import.meta.dirname);
    const guilty = globSync("**/*.{ts,tsx}", { cwd: root })
      .filter((file) => !file.includes(".test."))
      .filter((file) =>
        readFileSync(join(root, file), "utf8").includes("@ketocare/ui/testing"),
      );

    expect(guilty, "этот вход только для тестов").toEqual([]);
  });
});
