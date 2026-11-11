import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Элементы управления — только из кита (правило П55 канона,
 * docs/PLAN_UI_ORDER_2026-11.md, этапы 2 и 4).
 *
 * Браузерный список, флажок и поле даты выглядят по-разному в каждом
 * браузере и рядом с полями кита читаются как чужие. Оформленные замены
 * живут в одном месте каждая: список и дата — в `components/Field.tsx`,
 * флажок и переключатель — в ките. Сторож не даёт голому элементу вернуться
 * на экран.
 */
const SRC = __dirname;

/** Где системный элемент лежит намеренно — под оформленной заменой. */
const ALLOWED = new Set([join(SRC, "components", "Field.tsx")]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : [];
  });
}

/** Без комментариев: объяснение запрета не должно срабатывать как нарушение. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function offenders(pattern: RegExp): string[] {
  return sourceFiles(SRC)
    .filter((path) => !ALLOWED.has(path) && !path.includes("UiShowcase"))
    .filter((path) => pattern.test(code(path)))
    .map((path) => path.slice(SRC.length + 1));
}

describe("элементы управления — из кита", () => {
  it("нет голого <select>: выбор из списка — SelectField", () => {
    expect(offenders(/<select[\s>]/)).toEqual([]);
  });

  it("нет голого флажка: пункт формы — Checkbox, настройка — Switch", () => {
    expect(offenders(/type="checkbox"/)).toEqual([]);
  });

  it('нет голого поля даты: дата — Field type="date"', () => {
    expect(offenders(/<(input|Input)\b[^>]*type="date"/)).toEqual([]);
  });
});
