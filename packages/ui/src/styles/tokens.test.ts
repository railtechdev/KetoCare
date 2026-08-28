// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Ссылка на несуществующий токен ничем себя не проявляет.
 *
 * `var(--color-нет-такого)` раскрывается в пустую строку: сборка не падает,
 * линтер молчит, тип не жалуется. Recharts рисует сетку и оси невидимыми, а
 * Tailwind просто не выдаёт класс — так после переименования токенов под
 * словарь кита у самого тревожного баннера пропала цветная полоса, а у графиков
 * кетонов и веса — сетка. Заметить это можно было только глазами на конкретном
 * экране.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const CSS = readFileSync(
  fileURLToPath(new URL("./tokens.css", import.meta.url)),
  "utf-8",
);

/** Имена, объявленные в теме и в блоке псевдонимов. */
const DECLARED = new Set(
  [...CSS.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((match) => match[1]!),
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(entry) && !/\.test\./.test(entry)
      ? [path]
      : [];
  });
}

describe("токены темы", () => {
  it("var(--…) ссылается только на объявленные переменные", () => {
    const dangling: string[] = [];

    for (const path of sourceFiles(SRC)) {
      // Файлы кита пишем не мы: они ссылаются и на встроенные переменные
      // Tailwind (--spacing), которых в нашей теме нет и не должно быть.
      if (path.includes(join("components", "ui"))) continue;

      const text = readFileSync(path, "utf-8");
      for (const match of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const name = match[1]!;
        // Переменные Radix задаёт сам во время работы — их в теме нет и быть
        // не должно.
        if (name.startsWith("--radix-")) continue;
        if (!DECLARED.has(name)) {
          dangling.push(`${path.slice(SRC.length)}: ${name}`);
        }
      }
    }

    expect(dangling).toEqual([]);
  });

  it("в коде не осталось имён из прежнего словаря токенов", () => {
    // Переход на словарь shadcn переименовал роли, и утилиты вроде
    // `border-l-danger` перестали давать цвет: Tailwind просто не выдаёт класс,
    // ошибки при этом нет нигде. Так у самого тревожного баннера пропала полоса.
    //
    // Проверка именно по списку выбывших имён, а не «все ли утилиты цвета
    // объявлены»: отличить `bg-primary` от `text-sm` по виду класса нельзя, и
    // такая проверка либо пропускала бы дефекты, либо ругалась на размеры.
    const RETIRED = [
      "canvas",
      "surface",
      "ink",
      "line",
      "danger",
      "on-danger",
      "on-accent",
    ];
    const prefixes =
      "bg|text|border|border-l|border-t|border-b|border-r|ring|outline|fill|stroke|from|to|via|accent|caret|divide";
    const pattern = new RegExp(
      `\\b(?:${prefixes})-(${RETIRED.join("|")})\\b|--color-(${RETIRED.join("|")})\\b`,
      "g",
    );

    const found: string[] = [];
    for (const path of sourceFiles(SRC)) {
      if (path.includes(join("components", "ui"))) continue;
      if (path.endsWith(join("styles", "tokens.css"))) continue;
      for (const match of readFileSync(path, "utf-8").matchAll(pattern)) {
        found.push(`${path.slice(SRC.length)}: ${match[0]}`);
      }
    }

    expect(found).toEqual([]);
  });
});
