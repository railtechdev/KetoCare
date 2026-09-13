import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SECTIONS_BY_ROLE } from "../features/auth/roles";

/**
 * Проверка «экраны семьи помещаются в 360 px» живёт в сквозном прогоне и ведёт
 * перечень разделов руками: `apps/e2e` — отдельный пакет со своим `tsconfig`,
 * реестр кабинета он не импортирует и импортировать не может.
 *
 * Ручной список молча расходится с продуктом. Он уже разошёлся: у родителя
 * десять разделов, а проверялись семь — «Помощник», «Ребёнок» и «Профиль» на
 * телефонной ширине не открывал никто, при том что раздел 8.2 ТЗ называет
 * мобильный веб основным каналом семьи. Заметить это мог только человек,
 * сверивший два файла глазами.
 *
 * Поэтому файл прогона читается с диска и сверяется с ролевой таблицей. Тест
 * стоит в кабинете, а не в прогоне: ночной прогон идёт раз в сутки, а этот
 * падает сразу — в той же проверке, что и добавление раздела.
 */
const SPEC = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "e2e",
  "tests",
  "mobile.spec.ts",
);

function sectionsFromSpec(): string[] {
  const source = readFileSync(SPEC, "utf8");
  const list = /const SECTIONS = \[([^\]]*)\]/.exec(source);
  if (list === null) {
    throw new Error(`В ${SPEC} не найден перечень SECTIONS`);
  }
  return [...list[1]!.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]!);
}

describe("экраны семьи на телефоне", () => {
  it("проверяются все разделы родителя, а не часть", () => {
    const checked = new Set(sectionsFromSpec());
    const missing = SECTIONS_BY_ROLE.parent.filter(
      (section) => !checked.has(section),
    );

    expect(missing).toEqual([]);
  });

  it("не проверяет разделов, которых у родителя нет", () => {
    // Обратная сторона: раздел, убранный у роли, остался бы в прогоне и
    // открывался бы под родителем — то есть проверка ходила бы туда, куда
    // человек не ходит.
    const known = new Set(SECTIONS_BY_ROLE.parent);
    expect(sectionsFromSpec().filter((section) => !known.has(section))).toEqual(
      [],
    );
  });
});
