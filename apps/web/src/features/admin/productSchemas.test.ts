import { describe, expect, it } from "vitest";

import {
  productFormSchema,
  toProductCreateBody,
  toProductFormValues,
  toProductUpdateBody,
  type ProductFormValues,
} from "./productSchemas";
import type { Product } from "./types";

const VALID: ProductFormValues = {
  nameRu: "  Масло сливочное  ",
  nameUz: "",
  nameEn: " Butter ",
  categoryId: "6f1e5c34-9b7a-4c2d-8f10-2a3b4c5d6e7f",
  kcal: 717,
  fat: 81.1,
  protein: 0.85,
  carbs: 0.06,
  fiber: 0,
  source: " USDA ",
  sourceVersion: " SR Legacy 2018 ",
  verifiedAt: "2026-03-01",
  isActive: true,
};

describe("productFormSchema", () => {
  it("принимает заполненную карточку", () => {
    expect(productFormSchema.safeParse(VALID).success).toBe(true);
  });

  it.each(["source", "sourceVersion"] as const)(
    "не пропускает пустое поле %s",
    (field) => {
      // Критерий приёмки раздела 8.3 ТЗ: источник и его версия обязательны —
      // значение без них нельзя перепроверить, а по нему считается питание.
      const result = productFormSchema.safeParse({ ...VALID, [field]: "   " });
      expect(result.success).toBe(false);
    },
  );

  it("не пропускает пустую дату сверки", () => {
    expect(
      productFormSchema.safeParse({ ...VALID, verifiedAt: "" }).success,
    ).toBe(false);
  });

  it("не пропускает дату не в формате ГГГГ-ММ-ДД", () => {
    expect(
      productFormSchema.safeParse({ ...VALID, verifiedAt: "01.03.2026" })
        .success,
    ).toBe(false);
  });

  it("требует идентификатор категории в виде UUID", () => {
    expect(
      productFormSchema.safeParse({ ...VALID, categoryId: "молочные" }).success,
    ).toBe(false);
  });

  it("не пропускает отрицательную пищевую ценность", () => {
    expect(productFormSchema.safeParse({ ...VALID, fat: -1 }).success).toBe(
      false,
    );
  });

  it("не пропускает незаполненное числовое поле", () => {
    // Пустой `<input type="number">` с valueAsNumber даёт NaN — форма не должна
    // отправлять карточку без калорийности.
    expect(productFormSchema.safeParse({ ...VALID, kcal: NaN }).success).toBe(
      false,
    );
  });
});

describe("toProductCreateBody", () => {
  it("обрезает пробелы и превращает пустые названия в null", () => {
    const body = toProductCreateBody(VALID);

    expect(body.name_ru).toBe("Масло сливочное");
    expect(body.name_en).toBe("Butter");
    expect(body.name_uz).toBeNull();
    expect(body.source).toBe("USDA");
    expect(body.source_version).toBe("SR Legacy 2018");
    expect(body.verified_at).toBe("2026-03-01");
  });

  it("не отправляет флаг активности: новый продукт создаётся активным", () => {
    expect(toProductCreateBody(VALID)).not.toHaveProperty("is_active");
  });
});

describe("toProductUpdateBody", () => {
  it("добавляет флаг активности к тем же полям", () => {
    expect(toProductUpdateBody({ ...VALID, isActive: false })).toMatchObject({
      name_ru: "Масло сливочное",
      is_active: false,
    });
  });
});

describe("toProductFormValues", () => {
  it("разворачивает карточку с сервера в значения формы", () => {
    const product: Product = {
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      name_ru: "Масло сливочное",
      name_uz: null,
      name_en: "Butter",
      category_id: "6f1e5c34-9b7a-4c2d-8f10-2a3b4c5d6e7f",
      kcal_100g: 717,
      fat_100g: 81.1,
      protein_100g: 0.85,
      carbs_100g: 0.06,
      fiber_100g: 0,
      source: "USDA",
      source_version: "SR Legacy 2018",
      verified_at: "2026-03-01",
      is_active: false,
    };

    const values = toProductFormValues(product);

    // Отсутствующее название не должно превращаться в строку "null" в поле.
    expect(values.nameUz).toBe("");
    expect(values.isActive).toBe(false);
    expect(productFormSchema.safeParse(values).success).toBe(true);
  });
});
