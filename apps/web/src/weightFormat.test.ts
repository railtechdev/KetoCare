import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Масса тела показывается одной функцией на всех экранах.
 *
 * Один и тот же замер, показанный по-разному, читается как два: семья видела
 * «8.25», врач — «8,3», и это случилось ровно тогда, когда формат применили в
 * двух местах из пяти. Правило, записанное только комментарием, не выполняется
 * даже автором в тот же день — урок `SECURITY_REVIEW`.
 *
 * Проверка идёт по исходникам, а не по экранам: экранов с весом пять, и тест на
 * каждый из них пришлось бы помнить завести — а забытый шестой экран снова
 * покажет сырое число. Здесь забыть нельзя.
 */
const SRC = __dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/**
 * Окно перед `weight_kg`, в котором ищется признак подстановки в текст.
 *
 * Ста двадцати знаков хватает и на однострочный `t("…", { value: … })`, и на
 * многострочный, где ключ стоит строкой выше. Число, уходящее в ГРАФИК
 * (`value: log.weight_kg` рядом с `new Date(...)`), в окно с `t(` не попадает —
 * и правильно: там формат ни при чём, точка на оси форматируется осью.
 */
const WRAPPER_NEAR = 60;
const TRANSLATION_NEAR = 200;
const TRANSLATION = /\bt\(/;

function rawWeightUsages(source: string): number[] {
  const lines: number[] = [];
  for (const match of source.matchAll(/\bweight_kg\b/g)) {
    const at = match.index ?? 0;
    // Два окна, каждое под свою задачу. Обёртка стоит вплотную
    // (`formatWeight(entry.` — девятнадцать знаков), и узкое окно не зависит от
    // того, как перенесёт строки prettier. Ключ словаря бывает и абзацем выше,
    // поэтому его окно шире.
    const wrapped = source
      .slice(Math.max(0, at - WRAPPER_NEAR), at)
      .includes("formatWeight(");
    const translated = TRANSLATION.test(
      source.slice(Math.max(0, at - TRANSLATION_NEAR), at),
    );
    if (translated && !wrapped) {
      lines.push(source.slice(0, at).split("\n").length);
    }
  }
  return lines;
}

describe("вес показывается одним форматом", () => {
  it("ни один экран не подставляет сырое weight_kg в текст", () => {
    const offenders = sourceFiles(SRC).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return rawWeightUsages(source).map(
        (line) => `${relative(SRC, path)}:${line}`,
      );
    });

    expect(offenders).toEqual([]);
  });

  it("проверка ловит сырое и пропускает обёрнутое", () => {
    // Без этого случая регулярка могла бы не совпадать ни с чем, и тест был бы
    // зелёным всегда.
    expect(
      rawWeightUsages('t("weight.value", { value: entry.weight_kg })'),
    ).toEqual([1]);
    expect(
      rawWeightUsages(
        't("weight.value", { value: formatWeight(entry.weight_kg) })',
      ),
    ).toEqual([]);
  });

  it("не считает нарушением число, уходящее в график", () => {
    // Точку на оси форматирует ось, а не словарь.
    expect(
      rawWeightUsages(
        "return [{ at: new Date(log.occurred_at), value: log.weight_kg }];",
      ),
    ).toEqual([]);
  });
});
