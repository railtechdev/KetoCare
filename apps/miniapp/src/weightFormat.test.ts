import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Тот же сторож, что в кабинете, — потому что правило общее.
 *
 * Вес виден и семье в Mini App, и врачу в кабинете. Один замер, показанный
 * по-разному, читается как два: пока формат применяли выборочно, семья видела
 * «8.25», а врач «8,3». Копия проверки здесь намеренная: приложения не делят
 * тестовую обвязку, а забытый экран покажет сырое число независимо от того, в
 * каком из них он появится.
 */
const SRC = __dirname;
const WRAPPER_NEAR = 60;
const TRANSLATION_NEAR = 200;
const TRANSLATION = /\bt\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

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

describe("вес в Mini App показывается тем же форматом", () => {
  it("ни один экран не подставляет сырое weight_kg в текст", () => {
    const offenders = sourceFiles(SRC).flatMap((path) =>
      rawWeightUsages(readFileSync(path, "utf8")).map(
        (line) => `${relative(SRC, path)}:${line}`,
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("проверка ловит сырое и пропускает обёрнутое", () => {
    expect(rawWeightUsages('t("w", { value: w.weight_kg })')).toEqual([1]);
    expect(
      rawWeightUsages('t("w", { value: formatWeight(w.weight_kg) })'),
    ).toEqual([]);
  });
});
