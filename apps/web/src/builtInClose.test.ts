import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Встроенная кнопка закрытия кита подписана по-английски.
 *
 * `SheetContent` и `DialogContent` из shadcn/ui рисуют кнопку со скрытой
 * подписью «Close», и в русском интерфейсе скринридер так её и зачитывал.
 * Файлы кита руками не правятся (ADR-0005), поэтому каждое место выключает
 * встроенную кнопку (`showCloseButton={false}`) и ставит свою — с подписью из
 * словаря, как `FormSheet` и мобильное меню каркаса.
 */
const ROOT = join(__dirname, "../../..");
const SOURCES = [
  join(ROOT, "apps/web/src"),
  // Компоненты кита, кроме файлов shadcn/ui: те копируются командой `shadcn
  // add` и объявляют кнопку, а не используют её.
  join(ROOT, "packages/ui/src/components"),
];
const SHADCN = join(ROOT, "packages/ui/src/components/ui");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (path === SHADCN) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : [];
  });
}

/**
 * Открывающий тег целиком. Обычное `[^>]*` не годится: в атрибутах бывают
 * стрелочные функции, и первый `>` стоит внутри `=>`.
 */
function openingTag(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") depth -= 1;
    else if (text[i] === ">" && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

function contentTags(): { file: string; tag: string }[] {
  return SOURCES.flatMap(sourceFiles).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return [...text.matchAll(/<(?:SheetContent|DialogContent)\b/g)].map(
      (match) => ({
        file: relative(ROOT, path),
        tag: openingTag(text, match.index),
      }),
    );
  });
}

describe("встроенная кнопка закрытия кита", () => {
  it("ни одна панель и ни один диалог не рисуют английскую «Close»", () => {
    const withBuiltIn = contentTags()
      .filter(({ tag }) => !/\bshowCloseButton=\{false\}/.test(tag))
      .map(({ file }) => file);

    expect(withBuiltIn).toEqual([]);
  });

  it("проверка видит сами панели, а не проходит впустую", () => {
    // Без этого переименование файла или пути обнулило бы выборку, и первый
    // тест остался бы зелёным, ничего не проверяя.
    expect(contentTags().map(({ file }) => file)).toEqual(
      expect.arrayContaining([
        "apps/web/src/layouts/AppLayout.tsx",
        "packages/ui/src/components/FormSheet.tsx",
      ]),
    );
  });
});
