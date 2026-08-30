import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Дизайн-система объявляет свой отступ `--spacing-screen: 1.5rem` — из него
 * растут `gap-screen` и `p-screen`. Побочный эффект: имя `screen` перекрывает
 * встроенные утилиты Tailwind, и `min-h-screen` начинает означать 1.5rem вместо
 * высоты экрана.
 *
 * Молча: сборка не падает, тип не жалуется. Страница входа из-за этого
 * прижималась к верхнему краю, под ней оставалось пустое полполотна, и заметить
 * это можно было только глазами. Задеты были все четыре места, где высота
 * бралась «во весь экран», включая каркас приложения.
 *
 * Полную высоту берём через `dvh`: он учитывает сворачивающуюся адресную строку
 * мобильного браузера и в шкалу отступов не попадает.
 */
const SRC = __dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("высота во весь экран", () => {
  it("берётся через dvh, а не через перекрытое имя screen", () => {
    const offenders = sourceFiles(SRC)
      .filter((path) =>
        /\b(min-h|h|max-h)-screen\b/.test(readFileSync(path, "utf8")),
      )
      .map((path) => path.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });
});
