import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Словарь терминов кабинета (`docs/PLAN_UI_TEXT_2026-11.md`, раздел 3, и
 * `docs/UI_GUIDE.md`). Внутренняя кухня и прежние названия не возвращаются в
 * тексты: один предмет — одно слово. Печатные формы показывают «Версия
 * расчёта», и это слово не запрещено.
 */
const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/ядр[оау]/i, "расчётное ядро — внутренняя кухня"],
  [/сервер/i, "сервер — внутренняя кухня"],
  [/вердикт/i, "вердикт — внутренняя кухня"],
  [/сним(ок|к)/i, "снимок — внутренняя кухня"],
  [/план питания/i, "пишем «меню»"],
  [/план на день/i, "пишем «меню на день»"],
  [/раскладк/i, "пишем «блюдо»"],
  [/мои блюда|своих блюд|свои блюда/i, "пишем «блюда ребёнка»"],
  [/библиотек/i, "пишем «рецепты»"],
  [/коэффициент порции|множитель порции/i, "пишем «порция»"],
  [/выведен из оборота/i, "пишем «в архиве»"],
  [/назначить препарат/i, "пишем «добавить препарат»"],
  // Аудит 12.11.2026: названия чужих программ и авторов формул врачу ничего
  // не объясняют, а чужая программа в интерфейсе читается как заимствование.
  [/KDC|KetoDiet/i, "название чужой программы"],
  [/Холлиде|Сегар/i, "имя автора формулы — пишем, от чего считается"],
];

const DIR = join(__dirname, "ru");

function strings(value: unknown, path: string, out: [string, string][]) {
  if (typeof value === "string") out.push([path, value]);
  else if (value !== null && typeof value === "object")
    for (const [key, child] of Object.entries(value))
      strings(child, path === "" ? key : `${path}.${key}`, out);
  return out;
}

describe("словарь терминов кабинета", () => {
  it("ни одна строка не использует запрещённых слов", () => {
    const found: string[] = [];
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
      const entries = strings(
        JSON.parse(readFileSync(join(DIR, file), "utf8")),
        "",
        [],
      );
      for (const [key, text] of entries)
        for (const [pattern, why] of FORBIDDEN)
          if (pattern.test(text)) found.push(`${file}:${key} — ${why}`);
    }
    expect(found).toEqual([]);
  });
});
