import { describe, expect, it } from "vitest";

import { allergyNames } from "./allergies";
import type { Patient } from "./useChildren";

// Ровно то, что читает `allergyNames`: без аннотации выдуманное поле
// (`product_id` вместо `id`) вернулось бы молча.
type Allergies = Pick<Patient, "excluded_products" | "allergy_labels">;

describe("строка аллергий", () => {
  it("склеивает названия продуктов и свободные метки", () => {
    expect(
      allergyNames(
        {
          excluded_products: [{ id: "p1", name_ru: "Кокосовое масло" }],
          allergy_labels: ["цитрусовые"],
        } satisfies Allergies,
        "неизвестный продукт",
      ),
    ).toEqual(["Кокосовое масло", "цитрусовые"]);
  });

  it("не падает на ответе старого API", () => {
    // Во время выката фронт какое-то время говорит со старым сервером; разбор
    // ответа не должен ронять карту пациента целиком.
    expect(allergyNames({} as never, "неизвестный продукт")).toEqual([]);
  });

  it("называет продукт, пропавший из справочника, а не показывает пустоту", () => {
    expect(
      allergyNames(
        {
          excluded_products: [{ id: "p1", name_ru: null }],
          allergy_labels: [],
        } satisfies Allergies,
        "продукт удалён из справочника",
      ),
    ).toEqual(["продукт удалён из справочника"]);
  });
});
