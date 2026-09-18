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

/**
 * Своё `Intl.NumberFormat` на экране — то же нарушение П45, только незаметнее
 * `toFixed`: запись получается русская, но правило точности живёт копией.
 *
 * Так и разошлось: два помощника назывались `AMOUNT` и отличались точностью
 * (один знак в итогах дня, два в отчётах), а итоги дня в кабинете из-за этого
 * писались иначе, чем те же итоги в Mini App. `Intl.DateTimeFormat` не
 * запрещён — даты форматируются на месте и в кит не вынесены.
 *
 * Ищется СОЗДАНИЕ (`new Intl.NumberFormat`), а не упоминание: иначе проверка
 * падает на комментарии, объясняющем, почему своего форматирования тут нет, —
 * она поймала так сама себя.
 */
export function filesWithOwnNumberFormat(root: string): string[] {
  return globSync("**/*.{ts,tsx}", { cwd: root })
    .filter((file) => !file.includes(".test."))
    .filter((file) =>
      readFileSync(join(root, file), "utf8").includes("new Intl.NumberFormat"),
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

  it("не заводят своего Intl.NumberFormat мимо кита", () => {
    const guilty = filesWithOwnNumberFormat(join(import.meta.dirname));

    expect(
      guilty,
      "правило точности живёт в packages/ui/src/lib/format.ts — берите помощник оттуда",
    ).toEqual([]);
  });
});
