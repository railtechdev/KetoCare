import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { UNITS } from "./testing/dictionaryNumbers";

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

function kitSources(root: string): string[] {
  return globSync("**/*.{ts,tsx}", { cwd: root }).filter(
    (file) => !file.includes(".test."),
  );
}

/**
 * Значение, напечатанное рядом с единицей измерения, — через помощник.
 *
 * `toFixed` и своё `Intl.NumberFormat` были не единственным способом показать
 * сырое число: `{point.value} {unit}` не содержит ни того, ни другого, и оба
 * сторожа молчали. Так на графике динамики полтора месяца стояло «2.7 ммоль/л»
 * — в подсказке и в текстовой альтернативе, при том что карточка той же записи
 * печатала «2,7 ммоль/л». Один замер, один экран, две записи.
 *
 * Единица измерения в ките бывает двух видов: пропс `unit` у графика и слово в
 * разметке («г» у полосы макронутриентов). Проверяются оба — правило про то,
 * что видит человек, а не про то, откуда взялось слово.
 *
 * Ищется подстановка, за которой единица измерения стоит СРАЗУ (пробел или
 * `{" "}` от prettier). «Где-то рядом» проверять нельзя: в `MetricRow` между
 * значением и единицей лежит разметка, и значение там — готовый `ReactNode`,
 * который кит форматировать не может и не должен.
 */
export function rawValuesNextToUnit(source: string): string[] {
  const units = [...UNITS, "\\$?\\{unit\\}"].join("|");
  const pattern = new RegExp(
    `\\$?\\{([^{}]*)\\}(?:\\s|\\{" "\\})*(?:${units})(?!\\p{L})`,
    "gu",
  );

  return [...source.matchAll(pattern)]
    .map((match) => (match[1] ?? "").trim())
    .filter((expression) => !/\bformat[A-Z]\w*\s*\(/.test(expression));
}

/**
 * Числа на осях и в подсказках графика печатает тоже помощник.
 *
 * Recharts превращает число в текст в своих `formatter`-ах, и это второе место,
 * где значение минует `lib/format`: ось значений рисовала «0 0.7 1.4 2.1 2.8»,
 * пока у `YAxis` не было `tickFormatter`. Правило простое: тело любого
 * форматера в ките зовёт функцию с именем `format…` — у дат это `formatDate`
 * приложения, у значений помощник кита.
 */
export function formattersWithoutHelper(source: string): string[] {
  const found: string[] = [];

  for (const match of source.matchAll(
    /\b(tickFormatter|labelFormatter|formatter)=\{/g,
  )) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}") depth -= 1;
      i += 1;
    }
    const body = source.slice(start, i - 1);
    if (/\bformat[A-Z]\w*\s*\(/.test(body)) continue;

    found.push(`${match[1]}: ${body.replace(/\s+/g, " ").trim()}`);
  }

  return found;
}

/**
 * У оси значений есть свой форматер.
 *
 * Правило выше проверяет тело форматера — но не его отсутствие: без
 * `tickFormatter` recharts печатает число как есть, и ось дневника рисовала
 * «0 0.7 1.4 2.1 2.8». Удаление строки не ломало ни одного теста, поэтому
 * проверяется и сам факт.
 */
export function axesWithoutFormatter(source: string): number {
  const axes = source.match(/<YAxis\b/g) ?? [];
  const formatted = [...source.matchAll(/<YAxis\b[^>]*?tickFormatter=/gs)];

  return axes.length - formatted.length;
}

describe("числа в ките", () => {
  it("пишутся помощниками lib/format, а не toFixed", () => {
    const root = join(import.meta.dirname);
    const guilty = kitSources(root)
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

  it("не подставляют сырое значение рядом с единицей измерения", () => {
    const root = join(import.meta.dirname);
    const guilty = kitSources(root).flatMap((file) =>
      rawValuesNextToUnit(readFileSync(join(root, file), "utf8")).map(
        (expression) => `${file}: {${expression}} {unit}`,
      ),
    );

    expect(
      guilty,
      "значение рядом с единицей измерения печатается помощником lib/format",
    ).toEqual([]);
  });

  it("не отдают числа графика наружу без помощника", () => {
    const root = join(import.meta.dirname);
    const guilty = kitSources(root).flatMap((file) =>
      formattersWithoutHelper(readFileSync(join(root, file), "utf8")).map(
        (formatter) => `${file}: ${formatter}`,
      ),
    );

    expect(
      guilty,
      "tickFormatter и formatter графика зовут format… — иначе ось печатает «0.7»",
    ).toEqual([]);
  });

  it("не оставляют ось значений без форматера", () => {
    const root = join(import.meta.dirname);
    const guilty = kitSources(root).filter(
      (file) =>
        axesWithoutFormatter(readFileSync(join(root, file), "utf8")) > 0,
    );

    expect(
      guilty,
      "без tickFormatter ось печатает «0.7»: recharts не знает о правиле П45",
    ).toEqual([]);
  });

  it("ловят сырое и пропускают обёрнутое", () => {
    // Без этих случаев правило могло бы не совпадать ни с чем, и оба сторожа
    // были бы зелёными всегда. Так и случилось с общей проверкой словарей:
    // `\b` после «см» не срабатывает, и она молчала при семнадцати нарушениях.
    expect(rawValuesNextToUnit("<td>{point.value} {unit}</td>")).toEqual([
      "point.value",
    ]);
    expect(rawValuesNextToUnit('[`${value} ${unit}`, ""]')).toEqual(["value"]);
    expect(rawValuesNextToUnit("<span>{segment.grams} г</span>")).toEqual([
      "segment.grams",
    ]);
    // Разрыв строки prettier'ом правило не обходит.
    expect(rawValuesNextToUnit('<span>{entry.value}{" "}\nкг</span>')).toEqual([
      "entry.value",
    ]);

    expect(
      rawValuesNextToUnit("<td>{formatMeasured(point.value)} {unit}</td>"),
    ).toEqual([]);
    expect(
      rawValuesNextToUnit('[`${formatMeasured(value)} ${unit}`, ""]'),
    ).toEqual([]);
    expect(rawValuesNextToUnit("<span>{formatGrams(x)} г</span>")).toEqual([]);
    // Слово, начинающееся с единицы измерения, единицей не считается.
    expect(rawValuesNextToUnit("<span>{count} граммов</span>")).toEqual([]);
    // `MetricRow`: между значением и единицей — разметка, значение собирает
    // вызывающий. Форматировать `ReactNode` кит не может.
    expect(
      rawValuesNextToUnit(
        '{value ?? "—"}\n</span>\n{unit && <span className="x">{unit}</span>}',
      ),
    ).toEqual([]);

    expect(
      formattersWithoutHelper("tickFormatter={(ts: number) => String(ts)}"),
    ).toEqual(["tickFormatter: (ts: number) => String(ts)"]);
    expect(
      formattersWithoutHelper(
        "tickFormatter={(ts: number) => formatDate(new Date(ts))}",
      ),
    ).toEqual([]);

    expect(axesWithoutFormatter('<YAxis stroke="x" width={48} />')).toBe(1);
    expect(
      axesWithoutFormatter(
        '<YAxis stroke="x" tickFormatter={(v) => formatMeasured(v)} />',
      ),
    ).toBe(0);
  });
});
