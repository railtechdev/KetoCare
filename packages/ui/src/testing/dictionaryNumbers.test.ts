import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  argumentOf,
  calledKeys,
  goesThroughHelper,
  rawNumbersNextToUnits,
  unitVariables,
} from "./dictionaryNumbers";

/**
 * Проверка самой проверки.
 *
 * Первая версия не находила НИЧЕГО: конец единицы измерения описывался `\b`, а в
 * JavaScript границей слова считаются только ASCII-буквы — после «см» и «кг» её
 * нет. Сторож был зелёным при семнадцати нарушениях в кабинете, и выглядел
 * настроенным. Поэтому здесь проверяется и то, что он ловит, и то, что
 * пропускает.
 */
describe("сырое число рядом с единицей измерения", () => {
  it("видит переменную перед русской единицей измерения", () => {
    expect(unitVariables("{{value}} ммоль/л")).toEqual(["value"]);
    expect(unitVariables("Рост: {{value}} см")).toEqual(["value"]);
    expect(unitVariables("{{value}} г в сутки")).toEqual(["value"]);
    expect(unitVariables("{{kcal}} ккал ÷ {{meals}} приёма")).toEqual(["kcal"]);
    expect(unitVariables("{{value}} из {{target}} ккал")).toEqual(["target"]);
  });

  it("различает секунды и предлог «с»", () => {
    // «с» — и секунда, и предлог. Единицей она считается только в конце фразы
    // или перед знаком препинания: после предлога всегда идёт слово.
    expect(unitVariables("Длительность: {{value}} с")).toEqual(["value"]);
    expect(unitVariables("Длительность: {{value}} с.")).toEqual(["value"]);
    expect(unitVariables("Ещё {{count}} с пометками о приёме")).toEqual([]);
  });

  it("не считает единицей измерения начало слова", () => {
    // «{{count}} граммов» — слово, а не единица: проверять там нечего, и ложное
    // срабатывание заставило бы обходить правило пометками.
    expect(unitVariables("{{count}} граммов")).toEqual([]);
    expect(unitVariables("{{name}} готово")).toEqual([]);
  });

  it("достаёт выражение вызова и отличает обёрнутое от сырого", () => {
    const body = `"card.fiber", { value: data.fiber_100g }`;
    expect(argumentOf(body, "value")).toBe("data.fiber_100g");
    expect(goesThroughHelper("data.fiber_100g")).toBe(false);
    expect(goesThroughHelper("formatGrams(data.fiber_100g)")).toBe(true);

    // Запятая внутри вызова не обрывает выражение, а соседний ключ — обрывает.
    const nested = `"k", { value: formatKcal(a ?? 0), target: b }`;
    expect(argumentOf(nested, "value")).toBe("formatKcal(a ?? 0)");
    expect(argumentOf(nested, "target")).toBe("b");
    expect(argumentOf(nested, "missing")).toBeNull();
  });

  it("находит сырое в дереве приложения и молчит об обёрнутом", () => {
    const root = mkdtempSync(join(tmpdir(), "ketocare-numbers-"));
    mkdirSync(join(root, "locales/ru"), { recursive: true });
    writeFileSync(
      join(root, "locales/ru/child.json"),
      JSON.stringify({ card: { height: "Рост: {{value}} см" } }),
    );
    writeFileSync(
      join(root, "Raw.tsx"),
      `<p>{t("card.height", { value: child.height_cm })}</p>\n`,
    );
    writeFileSync(
      join(root, "Wrapped.tsx"),
      `<p>{t("card.height", { value: formatMeasured(child.height_cm) })}</p>\n`,
    );
    writeFileSync(
      join(root, "Marked.tsx"),
      `// number:raw — целое из справочника\n<p>{t("card.height", { value: 100 })}</p>\n`,
    );

    const found = rawNumbersNextToUnits({
      localesDir: join(root, "locales/ru"),
      sourceDir: root,
    });

    expect(found.map((item) => `${item.file}:${item.expression}`)).toEqual([
      "Raw.tsx:child.height_cm",
    ]);
  });

  it("видит обе ветви условного ключа", () => {
    // `t(delta > 0 ? "above" : "below", { value: Math.abs(delta) })` — число
    // одно на оба шаблона; калькулятор печатал его сырым («на 1200 ккал»).
    expect(calledKeys('delta > 0 ? "calc.above" : "calc.below"')).toEqual([
      "calc.above",
      "calc.below",
    ]);
    expect(calledKeys('"ns:card.height"')).toEqual(["card.height"]);
    expect(calledKeys("`charts.${kind}.unit`")).toEqual([]);

    const root = mkdtempSync(join(tmpdir(), "ketocare-numbers-"));
    mkdirSync(join(root, "locales/ru"), { recursive: true });
    writeFileSync(
      join(root, "locales/ru/app.json"),
      JSON.stringify({
        calc: {
          above: "на {{value}} ккал больше",
          below: "на {{value}} ккал меньше",
        },
      }),
    );
    writeFileSync(
      join(root, "Delta.tsx"),
      `<p>{t(delta > 0 ? "calc.above" : "calc.below", { value: Math.abs(delta) })}</p>\n`,
    );

    const found = rawNumbersNextToUnits({
      localesDir: join(root, "locales/ru"),
      sourceDir: root,
    });

    // Место одно — и в списке оно одно, под первым из ключей.
    expect(found.map((item) => `${item.file}:${item.expression}`)).toEqual([
      "Delta.tsx:Math.abs(delta)",
    ]);
  });
});
