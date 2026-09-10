import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Тот же сторож, что в кабинете, — потому что правило общее.
 *
 * Вес виден и семье в Mini App, и врачу в кабинете, и один замер, показанный
 * по-разному, читается как два. Копия проверки намеренная: приложения не делят
 * тестовую обвязку, а забытый экран покажет сырое число независимо от того, в
 * каком из них он появится.
 *
 * **Проверяется каждое чтение `weight_kg`, а не «похоже на показ».** Первая
 * версия искала рядом вызов `t(` и потому зависела от расстояния между словами:
 * подпись, добавленная рядом с точкой графика, зажгла бы её ложно, а число,
 * выведенное прямо в разметке (`{weight.weight_kg} кг`), она пропускала. Теперь
 * правило простое: либо `formatWeight(`, либо явная пометка `weight:raw` с
 * объяснением, зачем сырое число здесь уместно.
 *
 * Пометка — не лазейка: её видно в ревью, и она заставляет назвать причину.
 * Молчаливого способа вывести сырой вес не осталось.
 */
const SRC = __dirname;

/** Пометка «здесь сырое число намеренно» — ставится в той же или соседней строке. */
const RAW_MARKER = "weight:raw";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Строки файла, где `weight_kg` читается без обёртки и без пометки. */
export function rawWeightUsages(source: string): number[] {
  const lines = source.split("\n");
  const found: number[] = [];

  lines.forEach((line, index) => {
    if (!/\bweight_kg\b/.test(line)) return;
    // Объявление типа или поля схемы — не показ.
    if (/weight_kg\s*[?:]\s*(number|string|z\.)/.test(line)) return;
    if (line.includes("formatWeight(")) return;

    const nearby = lines.slice(Math.max(0, index - 2), index + 1).join("\n");
    if (nearby.includes(RAW_MARKER)) return;

    found.push(index + 1);
  });

  return found;
}

describe("вес в Mini App показывается тем же форматом", () => {
  it("ни одно место не читает weight_kg без обёртки и без пометки", () => {
    const offenders = sourceFiles(SRC).flatMap((path) =>
      rawWeightUsages(readFileSync(path, "utf8")).map(
        (line) => `${relative(SRC, path)}:${line}`,
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("ловит сырое, пропускает обёрнутое и помеченное", () => {
    // Без этого случая правило могло бы не совпадать ни с чем, и тест был бы
    // зелёным всегда.
    expect(rawWeightUsages("value: entry.weight_kg,")).toEqual([1]);
    expect(rawWeightUsages("<span>{weight.weight_kg} кг</span>")).toEqual([1]);
    expect(rawWeightUsages("value: formatWeight(entry.weight_kg),")).toEqual(
      [],
    );
    expect(
      rawWeightUsages("// weight:raw — точка графика\nvalue: log.weight_kg,"),
    ).toEqual([]);
  });

  it("не считает показом объявление типа", () => {
    expect(rawWeightUsages("  weight_kg: number;")).toEqual([]);
  });
});
