// @vitest-environment node
import { describe, expect, it } from "vitest";

import ru from "./ru/app.json";
import uz from "./uz/app.json";

/**
 * Узбекский словарь — зеркало русского (ADR-0052).
 *
 * Пропущенный ключ i18next молча заменяет русским (`fallbackLng`), и узбекская
 * семья получает экран вперемешку; лишняя или переименованная `{{переменная}}`
 * печатается как есть. Оба отказа видны только на живом экране — поэтому здесь.
 *
 * Множественное число у языков разное, и это не расхождение: русскому нужны
 * формы `one`/`few`/`many`, узбекскому — `one`/`other` (`Intl.PluralRules`).
 * Ключ сравнивается без суффикса формы, а набор форм — с правилами языка.
 */
const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(node: unknown, path: string[] = []): Map<string, string> {
  const result = new Map<string, string>();
  if (typeof node === "string") {
    result.set(path.join("."), node);
    return result;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      for (const [k, v] of flatten(value, [...path, key])) result.set(k, v);
    }
  }
  return result;
}

function baseKeys(dictionary: Map<string, string>): Set<string> {
  return new Set([...dictionary.keys()].map((key) => key.replace(PLURAL, "")));
}

function variables(template: string): string[] {
  return [...template.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)]
    .map((match) => match[1] ?? "")
    .sort();
}

function pluralForms(dictionary: Map<string, string>, base: string): string[] {
  return [...dictionary.keys()]
    .filter((key) => key.replace(PLURAL, "") === base && PLURAL.test(key))
    .map((key) => PLURAL.exec(key)?.[1] ?? "")
    .sort();
}

const RU = flatten(ru);
const UZ = flatten(uz);

describe("узбекский словарь Mini App", () => {
  it("содержит ровно те же ключи, что русский", () => {
    const missing = [...baseKeys(RU)].filter((key) => !baseKeys(UZ).has(key));
    const extra = [...baseKeys(UZ)].filter((key) => !baseKeys(RU).has(key));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it("подставляет те же переменные", () => {
    const differing = [...RU.entries()].flatMap(([key, template]) => {
      const twin =
        UZ.get(key) ??
        [...UZ.entries()].find(
          ([other]) => other.replace(PLURAL, "") === key.replace(PLURAL, ""),
        )?.[1];
      if (twin === undefined) return [];
      return variables(twin).join() === variables(template).join() ? [] : [key];
    });
    expect(differing).toEqual([]);
  });

  it("у множественного числа — формы своего языка", () => {
    const needed = (language: string) =>
      [...new Intl.PluralRules(language).resolvedOptions().pluralCategories]
        .filter((form) => form !== "zero" && form !== "two")
        .sort();

    const plurals = [...baseKeys(RU)].filter(
      (base) => pluralForms(RU, base).length > 0,
    );
    expect(plurals.length).toBeGreaterThan(0);
    for (const base of plurals) {
      expect(pluralForms(UZ, base), base).toEqual(needed("uz"));
    }
  });

  it("не оставляет пустых строк", () => {
    expect(
      [...UZ.entries()].filter(([, value]) => value.trim() === ""),
    ).toEqual([]);
  });

  it("подписи языков одинаковы в обоих словарях — их ищут, не читая", () => {
    for (const key of ["language.label", "language.ru", "language.uz"]) {
      expect(UZ.get(key), key).toBe(RU.get(key));
    }
  });
});
