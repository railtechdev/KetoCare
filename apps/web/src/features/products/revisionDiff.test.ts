// @vitest-environment node
import { describe, expect, it } from "vitest";

import { changedFields } from "./revisionDiff";

const BASE = {
  name_ru: "Масло сливочное",
  kcal_100g: 717,
  fat_100g: 81.1,
  protein_100g: 0.9,
  carbs_100g: 0.1,
  fiber_100g: 0,
  source: "USDA",
  source_version: "SR28",
  verified_at: "2026-01-01",
  is_active: true,
  category_id: "c1",
};

describe("разница между ревизиями", () => {
  it("называет только изменившиеся поля", () => {
    const changes = changedFields(
      { ...BASE, fat_100g: 82.5, source: "Лаборатория" },
      BASE,
    );

    expect(changes.map((c) => c.field)).toEqual(["fat_100g", "source"]);
    expect(changes[0]).toMatchObject({ before: 81.1, after: 82.5 });
  });

  it("у первой записи разницы нет — позицию не с чем сравнивать", () => {
    // «Заведена» и «ничего не изменилось» — разные утверждения, и подписывает
    // их вызывающая сторона.
    expect(changedFields(BASE, null)).toEqual([]);
  });

  it("не выдаёт другое представление числа за правку", () => {
    // Значения приходят из jsonb: 81.1 и 81.10 — одно и то же число, а строка
    // «жиры 81.1 → 81.1» утверждала бы правку, которой не было.
    expect(changedFields({ ...BASE, fat_100g: 81.1 }, BASE)).toEqual([]);
  });

  it("замечает вывод из оборота", () => {
    const changes = changedFields({ ...BASE, is_active: false }, BASE);
    expect(changes).toEqual([
      { field: "is_active", before: true, after: false },
    ]);
  });

  it("молчит о полях, которых нет в списке", () => {
    // `category_id` без названия категории ничего не сообщает, а тянуть
    // справочник ради строки истории — лишний запрос.
    expect(changedFields({ ...BASE, category_id: "c2" }, BASE)).toEqual([]);
  });
});
