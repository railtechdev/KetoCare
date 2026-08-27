// @vitest-environment node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resources } from "./i18n";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(full) && !full.endsWith(".test.tsx") ? [full] : [];
  });
}

/** Кириллический литерал в JSX-тексте или в строковой константе компонента. */
function findCyrillicLiterals(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const found: string[] = [];

  // Текст между тегами: >Текст<
  for (const match of withoutComments.matchAll(
    />[^<>{}\n]*[А-Яа-яЁё][^<>{}]*</g,
  )) {
    found.push(match[0].trim());
  }
  // Строковые литералы с кириллицей
  for (const match of withoutComments.matchAll(
    /["'`][^"'`\n]*[А-Яа-яЁё][^"'`\n]*["'`]/g,
  )) {
    found.push(match[0]);
  }

  return found;
}

describe("i18n", () => {
  it("в компонентах нет захардкоженных русских строк", () => {
    // Правило 8 CLAUDE.md / раздел 8.5 ТЗ: захардкоженная строка в JSX — ошибка
    // ревью. Проверяется автоматически, иначе требование держится на внимании
    // ревьюера и неизбежно нарушается.
    //
    // Сообщения `throw new Error` под это не подпадают и намеренно на английском:
    // они адресованы разработчику, а по тому же правилу 8 код и идентификаторы
    // ведутся по-английски. Пользователь их не видит — непойманные ошибки
    // показываются через локализованный текст.
    const offenders = sourceFiles(SRC)
      .map((file) => ({
        file,
        literals: findCyrillicLiterals(readFileSync(file, "utf-8")),
      }))
      .filter((entry) => entry.literals.length > 0);

    expect(
      offenders.map((o) => `${o.file}: ${o.literals.join(" | ")}`),
      "Используйте t('...') и добавьте ключ в src/locales/ru/",
    ).toEqual([]);
  });

  it("все объявленные пространства имён непусты", () => {
    for (const [ns, bundle] of Object.entries(resources.ru)) {
      expect(
        Object.keys(bundle).length,
        `Пространство ${ns} пусто`,
      ).toBeGreaterThan(0);
    }
  });
});
