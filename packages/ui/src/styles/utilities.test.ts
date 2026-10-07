// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

/**
 * Имена наших токенов не должны перекрывать встроенные утилиты Tailwind.
 *
 * Отступ `--spacing-block` порождал утилиту `inline-block` с
 * `inline-size: var(--spacing-block)` — и обычный `inline-block` (display)
 * получал ширину 16 px: ссылка «У меня есть код доступа» на входе стояла по
 * слову в строке. Та же ловушка уже была с `--spacing-screen` и `min-h-screen`
 * (`apps/web/src/styles.test.ts`). Проверяется собранный CSS, а не список
 * имён: перекрытие видно только в том, что выдаёт Tailwind.
 */
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function build(candidates: string[]): Promise<string> {
  const css = readFileSync(join(here, "tokens.css"), "utf-8").replace(
    /@source[^;]*;/g,
    "",
  );
  const compiler = await compile(css, {
    base: here,
    loadStylesheet: async (id: string, base: string) => {
      const path =
        id === "tailwindcss"
          ? require.resolve("tailwindcss/index.css")
          : join(base, id);
      return {
        path,
        base: dirname(path),
        content: readFileSync(path, "utf-8"),
      };
    },
  });
  return compiler.build(candidates);
}

/** Тело правила для класса `.name` в собранном CSS. */
function ruleOf(css: string, name: string): string {
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css);
  return match?.[1] ?? "";
}

describe("утилиты Tailwind не перекрыты токенами", () => {
  it.each(["inline-block", "inline-flex", "block", "inline", "inline-grid"])(
    "%s — только display, без размера из шкалы отступов",
    async (name) => {
      const rule = ruleOf(await build([name]), name);
      expect(rule).toMatch(/display:/);
      expect(rule).not.toMatch(/inline-size|block-size|width|height/);
    },
  );

  it("узкий блок ставит действие под заголовок — запросом к ширине блока", async () => {
    // `Section`: в блоке уже 28rem рядом с двумя кнопками заголовок сжимался
    // до нуля. Класс, которого Tailwind не понял, не выдаёт ничего — и раскладка
    // молча осталась бы прежней, поэтому проверяется собранный CSS.
    const css = await build([
      "@max-md:has-data-[slot=card-action]:grid-cols-1",
      "[&>[data-slot=card-action]]:@max-md:col-start-1",
      "[&>[data-slot=card-action]]:@max-md:justify-self-start",
    ]);
    expect(css).toMatch(/@container\s*\(width < 28rem\)/);
    expect(css).toMatch(/grid-template-columns:\s*repeat\(1/);
    expect(css).toMatch(/grid-column-start:\s*1/);
    expect(css).toMatch(/justify-self:\s*flex-start|justify-self:\s*start/);
  });

  it("отступы шкалы по-прежнему собираются", async () => {
    const css = await build(["gap-section", "p-screen", "gap-field"]);
    expect(ruleOf(css, "gap-section")).toMatch(/--spacing-section/);
    expect(ruleOf(css, "p-screen")).toMatch(/--spacing-screen/);
  });
});
