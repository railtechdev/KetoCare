import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FORBIDDEN_TERMS,
  forbiddenTermsIn,
  type ForbiddenTerm,
} from "@ketocare/ui/testing";
import { describe, expect, it } from "vitest";

/**
 * Словарь терминов (`docs/PLAN_UI_TEXT_2026-11.md`, раздел 3).
 *
 * Общий список запрещённых слов — `@ketocare/ui/testing` (`forbiddenTerms.json`):
 * по нему проверяются все четыре канала, кабинет, Mini App, бот и рассылки.
 * Здесь к нему добавлены слова, которые встречались только в кабинете: прежние
 * названия его собственных предметов.
 */
const CABINET_TERMS: readonly ForbiddenTerm[] = [
  { pattern: /сним(ок|к)/i, why: "снимок — внутренняя кухня" },
  { pattern: /раскладк/i, why: "пишем «блюдо»" },
  {
    pattern: /мо[её] блюд|мои блюд|сво[её] блюд|свои[хм]? блюд|ваш[а-я]* блюд/i,
    why: "пишем «блюда ребёнка»",
  },
  { pattern: /библиотек/i, why: "пишем «рецепты»" },
  {
    pattern: /коэффициент порции|множитель порции/i,
    why: "пишем «порция»",
  },
  { pattern: /назначить препарат/i, why: "пишем «добавить препарат»" },
  { pattern: /позици[яиюей]/i, why: "пишем «продукт» или «блюдо»" },
  {
    pattern: /стандарт(?!н)|внешний документ|редакци/i,
    why: "пишем «источник», «справочник клиники», «издание»",
  },
  { pattern: /мимо цели/i, why: "пишем «не по назначению»" },
  { pattern: /подогна|подгон/i, why: "пишем «пересчитать под ребёнка»" },
  { pattern: /снять ведение/i, why: "пишем «убрать из ведущих»" },
  { pattern: /TOTP|мини-приложени/i, why: "пишем «код входа», «приложение»" },
];

/**
 * Где запрещённое слово оправдано. Ключ — `файл:ключ`.
 *
 * Версия расчёта остаётся в печатных формах (раздел 3 словаря): карточка блюда
 * на бумаге — документ, по которому через год восстанавливают, чем считали.
 */
const ALLOWED = new Set(["calculator.json:engineVersion"]);

const DIR = join(__dirname, "ru");

describe("словарь терминов кабинета", () => {
  it("ни одна строка не использует запрещённых слов", () => {
    const terms = [...FORBIDDEN_TERMS, ...CABINET_TERMS];
    const found = readdirSync(DIR)
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) =>
        forbiddenTermsIn(
          file,
          JSON.parse(readFileSync(join(DIR, file), "utf8")),
          terms,
        ),
      )
      .filter((entry) => !ALLOWED.has(entry.split(" — ")[0] ?? ""));
    expect(found).toEqual([]);
  });

  it("исключения не пережили своих строк", () => {
    // Исключение без строки — дыра на будущее: под тем же ключом однажды
    // появится другой текст, и проверка его пропустит.
    for (const entry of ALLOWED) {
      const [file, key] = entry.split(":");
      const dict = JSON.parse(
        readFileSync(join(DIR, file ?? ""), "utf8"),
      ) as Record<string, unknown>;
      expect(typeof dict[key ?? ""], entry).toBe("string");
    }
  });
});
