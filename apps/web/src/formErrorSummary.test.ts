import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Правило П8 канона исполняемое: каждая форма на react-hook-form показывает
 * сводку ошибок после неудачной отправки.
 *
 * До проверки сводка стояла в пяти формах из двадцати — у назначения, продукта,
 * учётной записи, словаря и пароля. Остальные оставляли человека у кнопки внизу:
 * вход, дневник, препарат, рецепт. Правило было записано с самого начала канона,
 * а выполнялось там, где о нём помнил автор экрана.
 *
 * Проверка статическая и грубая намеренно: форма, где `useForm` есть, а
 * `FormErrorSummary` нет, — почти наверняка забыта. Исключение заводится в
 * списке ниже с причиной, а не молча.
 */
const ALLOWED_WITHOUT_SUMMARY: Record<string, string> = {};

/** Файл заводит форму react-hook-form, а сводки ошибок не рисует. */
export function lacksSummary(source: string): boolean {
  return (
    /\buseForm\s*[<(]/.test(source) && !source.includes("<FormErrorSummary")
  );
}

export function formsWithoutSummary(root: string): string[] {
  return globSync("**/*.tsx", { cwd: root })
    .filter((file) => !file.includes(".test."))
    .filter((file) => lacksSummary(readFileSync(join(root, file), "utf8")))
    .filter((file) => !(file in ALLOWED_WITHOUT_SUMMARY))
    .sort();
}

describe("сводка ошибок форм (правило П8)", () => {
  it("есть у каждой формы на react-hook-form", () => {
    expect(
      formsWithoutSummary(import.meta.dirname),
      "добавьте <FormErrorSummary items={errorSummaryItems(submitCount, …)} /> первым элементом формы",
    ).toEqual([]);
  });

  it("проверка видит форму без сводки и не трогает файлы без форм", () => {
    // Иначе опечатка в шаблоне поиска сделала бы проверку вечно зелёной.
    expect(lacksSummary("const f = useForm<Values>({});")).toBe(true);
    expect(lacksSummary("const f = useForm({});")).toBe(true);
    expect(
      lacksSummary("useForm<V>(); return <FormErrorSummary items={[]} />"),
    ).toBe(false);
    expect(lacksSummary("import { useFormState } from 'x';")).toBe(false);
  });
});
