import { describe, expect, it } from "vitest";

import { ROLES, SECTIONS_BY_ROLE } from "../features/auth/roles";
import { PENDING_SECTIONS, SECTION_ICONS, SECTION_SCREENS } from "./sections";

const ALL_SECTIONS = [
  ...new Set(ROLES.flatMap((role) => SECTIONS_BY_ROLE[role])),
];

describe("разделы кабинета", () => {
  it("у каждого раздела из ролевой таблицы есть экран или явная заглушка", () => {
    // Раздел, добавленный в SECTIONS_BY_ROLE и никуда не подключённый, иначе
    // отрисовался бы заглушкой «раздел в разработке» — то есть выглядел бы
    // как запланированная работа, а не как забытая проводка экрана.
    const orphans = ALL_SECTIONS.filter(
      (section) =>
        !(section in SECTION_SCREENS) && !PENDING_SECTIONS.includes(section),
    );
    expect(orphans).toEqual([]);
  });

  it("не объявляет экранов и заглушек для несуществующих разделов", () => {
    const known = new Set(ALL_SECTIONS);
    expect(Object.keys(SECTION_SCREENS).filter((s) => !known.has(s))).toEqual(
      [],
    );
    expect(PENDING_SECTIONS.filter((s) => !known.has(s))).toEqual([]);
  });

  it("раздел не может быть одновременно готовым и ожидаемым", () => {
    expect(PENDING_SECTIONS.filter((s) => s in SECTION_SCREENS)).toEqual([]);
  });

  it("первый раздел каждой роли ведёт на готовый экран", () => {
    // На первый раздел роль попадает сразу после входа (appIndexRoute),
    // поэтому заглушка на нём означала бы пустой кабинет вместо кабинета.
    for (const role of ROLES) {
      expect(SECTIONS_BY_ROLE[role][0]).toBeDefined();
      expect(SECTION_SCREENS).toHaveProperty(SECTIONS_BY_ROLE[role][0]!);
    }
  });

  it("у каждого раздела есть значок", () => {
    // Раздел без значка оставляет дырку в навигации — заметно только глазами,
    // поэтому проверяется здесь.
    const missing = ALL_SECTIONS.filter(
      (section) => !(section in SECTION_ICONS),
    );
    expect(missing).toEqual([]);
  });
});

describe("пункты меню без экрана", () => {
  it("их нет: раздел появляется вместе со своей работой", () => {
    // «Сводки» вели на заглушку «раздел появится на следующем шаге разработки»
    // — и это была половина навигации врача. Пункт меню, за которым ничего
    // нет, хуже его отсутствия (правило П3 канона).
    expect(PENDING_SECTIONS).toEqual([]);
  });
});
