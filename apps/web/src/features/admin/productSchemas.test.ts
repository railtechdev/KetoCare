import { describe, expect, it } from "vitest";

import {
  fiberFromInput,
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
  // На 1 г, как вводит диетолог (ADR-0065): 717 ккал и 81,1 г на 100 г.
  kcal: 7.17,
  fat: 0.811,
  protein: 0.0085,
  carbs: 0.0006,
  fiber: 0,
  source: " USDA ",
  sourceVersion: " SR Legacy 2018 ",
  verifiedAt: "2026-03-01",
  isActive: true,
  seasoning: false,
  carbsWithoutFiber: false,
  confirmed: {
    kcal: false,
    fat: false,
    protein: false,
    carbs: false,
    fiber: false,
  },
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

  it("принимает идентификатор категории вне вариантов RFC 9562", () => {
    // `uuid()` в zod 4 проверяет версию и вариант, а идентификатор здесь выбран
    // из справочника: форма не должна отказывать в существующей категории.
    const categoryId = "00000000-0000-0000-0000-000000000001";
    expect(productFormSchema.safeParse({ ...VALID, categoryId }).success).toBe(
      true,
    );
  });

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

  it.each(["fat", "protein", "carbs", "fiber"] as const)(
    "не пропускает %s больше 1 г в 1 г — это число на 100 г (ADR-0073)",
    (field) => {
      const result = productFormSchema.safeParse({ ...VALID, [field]: 82 });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.code).toBe("too_big");
    },
  );

  it("пропускает ровно 1 г в 1 г — масло без примесей", () => {
    expect(
      productFormSchema.safeParse({ ...VALID, fat: 1, protein: 0, carbs: 0 })
        .success,
    ).toBe(true);
  });

  it("не пропускает калорийность 1 г больше 10 ккал", () => {
    expect(productFormSchema.safeParse({ ...VALID, kcal: 717 }).success).toBe(
      false,
    );
    expect(productFormSchema.safeParse({ ...VALID, kcal: 9 }).success).toBe(
      true,
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

  it("пустая клетчатка уходит нулём с пометкой «не указана»", () => {
    // Замечание диетолога 17.11.2026: клетчатку пишут не на каждой упаковке.
    const parsed = productFormSchema.parse({
      ...VALID,
      fiber: fiberFromInput(""),
    });
    const body = toProductCreateBody(parsed);

    expect(body.fiber_100g).toBe(0);
    expect(body.fiber_known).toBe(false);
    // Указанная клетчатка пометки не несёт: решает правило стандарта.
    expect(toProductCreateBody(VALID)).not.toHaveProperty("fiber_known");
    // У правки пометки нет: известность решает сервер по вписанному числу.
    expect(toProductUpdateBody(parsed)).not.toHaveProperty("fiber_known");
  });
});

describe("toProductUpdateBody", () => {
  it("подтверждённый прочерк уходит в confirmed_fields (ADR-0067)", () => {
    const body = toProductUpdateBody({
      ...VALID,
      confirmed: { ...VALID.confirmed, carbs: true },
    });
    expect(body.confirmed_fields).toEqual(["carbs_100g"]);
    expect(toProductUpdateBody(VALID).confirmed_fields).toEqual([]);
  });

  it("отметка приправы уходит обратным counts_in_calculation (ADR-0054)", () => {
    expect(toProductCreateBody(VALID).counts_in_calculation).toBe(true);
    expect(
      toProductCreateBody({ ...VALID, seasoning: true }).counts_in_calculation,
    ).toBe(false);
  });

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
      counts_in_calculation: false,
      standard_id: "00000000-0000-7000-8000-000000000001",
      food_id: "00000000-0000-4000-8000-0000000000f1",
      fiber_known: true,
      // Считается сервером на чтении: 81.1 / (0.9 + 0.1).
      ratio: 81.1,
    };

    const values = toProductFormValues(product);

    // Отсутствующее название не должно превращаться в строку "null" в поле.
    expect(values.nameUz).toBe("");
    expect(values.isActive).toBe(false);
    // Форма спрашивает «это приправа?» — обратное `counts_in_calculation`.
    expect(values.seasoning).toBe(true);
    expect(productFormSchema.safeParse(values).success).toBe(true);
  });
});

describe("углеводы с этикетки без клетчатки (М5 аудита ядра)", () => {
  // Брокколи с этикетки: углеводы 3,2 г без клетчатки и клетчатка 2,4 г на 100 г.
  const broccoli = { ...VALID, carbs: 0.032, fiber: 0.024 };

  it("без отметки углеводы уходят как введены — уже вместе с клетчаткой", () => {
    expect(toProductCreateBody(broccoli).carbs_100g).toBeCloseTo(3.2);
  });

  it("с отметкой клетчатка прибавляется: справочник хранит углеводы с ней", () => {
    const body = toProductCreateBody({ ...broccoli, carbsWithoutFiber: true });
    expect(body.carbs_100g).toBeCloseTo(5.6);
    expect(body.fiber_100g).toBeCloseTo(2.4);
    expect(body).not.toHaveProperty("carbsWithoutFiber");
  });

  it("карточка из справочника открывается без отметки", () => {
    expect(
      toProductFormValues({
        ...({} as Product),
        name_ru: "Брокколи",
        name_uz: null,
        name_en: null,
        category_id: VALID.categoryId,
        kcal_100g: 34,
        fat_100g: 0.4,
        protein_100g: 2.8,
        carbs_100g: 5.6,
        fiber_100g: 2.4,
        source: "Этикетка",
        source_version: "2026",
        verified_at: "2026-11-16",
        is_active: true,
        counts_in_calculation: true,
      }).carbsWithoutFiber,
    ).toBe(false);
  });
});
