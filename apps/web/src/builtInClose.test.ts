import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Встроенные кнопки закрытия кита подписаны по-английски.
 *
 * `SheetContent` и `DialogContent` из shadcn/ui рисуют кнопку со скрытой
 * подписью «Close», `DialogFooter showCloseButton` — видимую кнопку «Close», а
 * `CommandDialog` сам включает кнопку и по умолчанию озаглавлен «Command
 * Palette». В русском интерфейсе скринридер так их и зачитывал. Файлы кита
 * руками не правятся (ADR-0005), поэтому каждое место выключает встроенное и
 * ставит своё — с подписью из словаря, как `FormSheet` и мобильное меню каркаса.
 */
const ROOT = join(__dirname, "../../..");
const SOURCES = [
  join(ROOT, "apps/web/src"),
  join(ROOT, "apps/miniapp/src"),
  // Компоненты кита, кроме файлов shadcn/ui: те копируются командой `shadcn
  // add` и объявляют кнопку, а не используют её.
  join(ROOT, "packages/ui/src/components"),
];
const SHADCN = join(ROOT, "packages/ui/src/components/ui");

const FLAG_OFF = /\bshowCloseButton=\{false\}/;

/** Что тег обязан содержать, чтобы английская подпись не попала на экран. */
const RULES: { tag: string; ok: (tag: string) => boolean }[] = [
  { tag: "SheetContent", ok: (tag) => FLAG_OFF.test(tag) },
  { tag: "DialogContent", ok: (tag) => FLAG_OFF.test(tag) },
  {
    tag: "CommandDialog",
    ok: (tag) =>
      FLAG_OFF.test(tag) &&
      // Не `\b`: он срабатывает после дефиса, и `data-title` сошёл бы за заголовок.
      /(?<![\w-])title=/.test(tag) &&
      /(?<![\w-])description=/.test(tag),
  },
  // Здесь наоборот: кнопки нет, пока флаг не включён.
  {
    tag: "DialogFooter",
    ok: (tag) => !/\bshowCloseButton(?!=\{false\})/.test(tag),
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (path === SHADCN) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : [];
  });
}

/** Текст без комментариев: объяснение запрета не должно само его нарушать. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Открывающий тег целиком или `null`, если его не разобрать. Обычное `[^>]*`
 * не годится: в атрибутах бывают стрелочные функции, и первый `>` стоит внутри
 * `=>`. Несбалансированная скобка (`title={"}"}`) — не разобрано, а не «тег до
 * конца файла»: иначе флаг соседнего тега засчитался бы этому.
 */
function openingTag(text: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth < 0) return null;
    } else if (text[i] === ">" && depth === 0) {
      return text.slice(start, i + 1);
    }
  }
  return null;
}

function violations(file: string, source: string): string[] {
  const text = code(source);
  return RULES.flatMap(({ tag, ok }) =>
    [...text.matchAll(new RegExp(`<${tag}\\b`, "g"))].flatMap((match) => {
      const found = openingTag(text, match.index);
      if (found === null) return [`${file}: <${tag} — тег не разобран`];
      return ok(found) ? [] : [`${file}: <${tag}`];
    }),
  );
}

function projectFiles() {
  return SOURCES.flatMap(sourceFiles).map((path) => ({
    file: relative(ROOT, path),
    source: readFileSync(path, "utf8"),
  }));
}

describe("встроенные кнопки закрытия кита", () => {
  it("ни одна панель и ни один диалог не рисуют английскую «Close»", () => {
    expect(
      projectFiles().flatMap(({ file, source }) => violations(file, source)),
    ).toEqual([]);
  });

  it("проверка видит сами панели, а не проходит впустую", () => {
    // Без этого переименование файла или пути обнулило бы выборку, и первый
    // тест остался бы зелёным, ничего не проверяя.
    const withPanels = projectFiles()
      .filter(({ source }) => /<(?:SheetContent|DialogContent)\b/.test(source))
      .map(({ file }) => file);

    expect(withPanels).toEqual(
      expect.arrayContaining([
        "apps/web/src/layouts/AppLayout.tsx",
        "packages/ui/src/components/FormSheet.tsx",
      ]),
    );
  });

  it("разбор тега не засчитывает флаг соседнего и не спотыкается о стрелку", () => {
    // Лишняя закрывающая и лишняя открывающая скобка в строке атрибута: в
    // обоих случаях тег не разобран, и флаг следующего тега ему не достаётся —
    // в том числе когда сосед стоит внутри выражения и скобки снова сходятся.
    const neighbour = "x</SheetContent><SheetContent showCloseButton={false}>";
    const inExpression =
      "x</SheetContent>\n{open && <SheetContent showCloseButton={false}>y</SheetContent>}";
    expect(
      violations("a.tsx", `<SheetContent title={"}"}>${neighbour}`),
    ).not.toEqual([]);
    expect(
      violations("a2.tsx", `<SheetContent title={"}"}>${inExpression}`),
    ).not.toEqual([]);
    expect(
      violations("b.tsx", `<SheetContent title={"{"}>${neighbour}`),
    ).not.toEqual([]);
    expect(
      violations(
        "c.tsx",
        "<SheetContent onOpenAutoFocus={(event) => event.preventDefault()} showCloseButton={false}>",
      ),
    ).toEqual([]);
  });

  it("CommandDialog — без кнопки и со своими заголовком и описанием, DialogFooter — без кнопки", () => {
    expect(
      violations("c.tsx", "<CommandDialog showCloseButton={false}>"),
    ).not.toEqual([]);
    // Настоящий заголовок и описание только в `aria-`/`data-` атрибуте —
    // по отдельности, иначе второе нарушение прикрыло бы первое.
    expect(
      violations(
        "c2.tsx",
        '<CommandDialog showCloseButton={false} data-title="x" description={t("y")}>',
      ),
    ).not.toEqual([]);
    expect(
      violations(
        "c3.tsx",
        '<CommandDialog showCloseButton={false} title={t("x")} aria-description="y">',
      ),
    ).not.toEqual([]);
    expect(
      violations(
        "d.tsx",
        '<CommandDialog showCloseButton={false} title={t("x")} description={t("y")}>',
      ),
    ).toEqual([]);
    expect(violations("e.tsx", "<DialogFooter showCloseButton>")).not.toEqual(
      [],
    );
    expect(
      violations("f.tsx", "<DialogFooter showCloseButton={false}>"),
    ).toEqual([]);
  });
});
