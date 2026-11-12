import { toPer100, toPerGram } from "@ketocare/ui";
import type { DefaultValues } from "react-hook-form";
import { z } from "zod";

import type { Product, ProductCreateBody, ProductUpdateBody } from "./types";

const requiredText = z.string().trim().min(1);

/**
 * Пищевая ценность НА 1 Г — так её вводит диетолог (ADR-0065). В тело запроса
 * уходит на 100 г: хранение и расчёт не меняются. Отрицательной не бывает,
 * ноль допустим (вода, соль).
 *
 * Верхняя граница — не копия политики сервера, а физика: в одном грамме
 * продукта не бывает больше грамма жира, белка, углеводов или клетчатки.
 * Число больше единицы почти всегда перенесено из колонки «на 100 г»: «82» в
 * поле «Жиры в 1 г» без этой границы ушло бы на сервер как 8 200 г на 100 г и
 * вернулось бы непонятным отказом (ADR-0072).
 */
export const MAX_GRAMS_PER_GRAM = 1;

/**
 * Калорийность 1 г: у чистого жира около 9 ккал. Граница — та же, что у
 * импорта (1 000 ккал на 100 г): её превышение — это килоджоули или число
 * на 100 г.
 */
export const MAX_KCAL_PER_GRAM = 10;

const gramsPerGram = z.number().nonnegative().max(MAX_GRAMS_PER_GRAM);
const kcalPerGram = z.number().nonnegative().max(MAX_KCAL_PER_GRAM);

/**
 * Схема формы продукта (раздел 8.3 ТЗ, «Админ / Продукты»).
 *
 * `source`, `source_version` и `verified_at` обязательны по критерию приёмки:
 * значение без указания источника и даты сверки нельзя ни перепроверить, ни
 * сослаться на него в расчёте, а расчёт по нему получит ребёнок.
 *
 * Предельные значения (длина названия, потолок калорийности) остаются за
 * сервером: их копия на клиенте со временем разошлась бы со схемой API.
 */
export const productFormSchema = z.object({
  nameRu: requiredText,
  nameUz: z.string().trim(),
  nameEn: z.string().trim(),
  categoryId: z.string().trim().guid(),
  kcal: kcalPerGram,
  fat: gramsPerGram,
  protein: gramsPerGram,
  carbs: gramsPerGram,
  fiber: gramsPerGram,
  source: requiredText,
  sourceVersion: requiredText,
  /** `<input type="date">` отдаёт ISO-дату; пустое поле не проходит проверку */
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isActive: z.boolean(),
  /**
   * Приправа: стоит в составе, но в расчёт не входит (ADR-0054, ответ клиники
   * на вопрос 16 — «соль, перец не учитываются в расчётах»). В форме — прямой
   * вопрос «это приправа?», а не «учитывать в расчёте?»: так его и задаёт
   * клиника. В теле запроса — обратное `counts_in_calculation`.
   */
  seasoning: z.boolean(),
  /**
   * Поля с прочерком источника (ADR-0067), число в которых человек
   * подтвердил как есть. Без отметки настоящий ноль на месте прочерка не
   * отличить от «нет данных»: пометка снимается только сменой числа.
   */
  // Флажок стоит только у поля с прочерком: у остальных значения нет вовсе.
  confirmed: z
    .object({
      kcal: z.boolean().optional(),
      fat: z.boolean().optional(),
      protein: z.boolean().optional(),
      carbs: z.boolean().optional(),
      fiber: z.boolean().optional(),
    })
    .optional(),
});

/** Поле формы → поле значения API. */
export const NUTRIENT_FIELDS = {
  kcal: "kcal_100g",
  fat: "fat_100g",
  protein: "protein_100g",
  carbs: "carbs_100g",
  fiber: "fiber_100g",
} as const;

export type Nutrient = keyof typeof NUTRIENT_FIELDS;

const NO_CONFIRMED = {
  kcal: false,
  fat: false,
  protein: false,
  carbs: false,
  fiber: false,
};

export type ProductFormValues = z.infer<typeof productFormSchema>;

/**
 * Числовые поля намеренно пусты: пищевую ценность администратор переносит из
 * источника, а подставленное «правдоподобное» значение легко сохранить не
 * заметив — и оно попадёт в расчёт меню.
 */
export const EMPTY_PRODUCT_FORM_VALUES: DefaultValues<ProductFormValues> = {
  nameRu: "",
  nameUz: "",
  nameEn: "",
  categoryId: "",
  source: "",
  sourceVersion: "",
  verifiedAt: "",
  isActive: true,
  // Какие продукты приправы, решает тот, кто заводит карточку: по умолчанию
  // продукт считается.
  seasoning: false,
  confirmed: NO_CONFIRMED,
};

export function toProductFormValues(product: Product): ProductFormValues {
  return {
    nameRu: product.name_ru,
    nameUz: product.name_uz ?? "",
    nameEn: product.name_en ?? "",
    categoryId: product.category_id,
    kcal: toPerGram(product.kcal_100g),
    fat: toPerGram(product.fat_100g),
    protein: toPerGram(product.protein_100g),
    carbs: toPerGram(product.carbs_100g),
    fiber: toPerGram(product.fiber_100g),
    source: product.source,
    sourceVersion: product.source_version,
    verifiedAt: product.verified_at,
    isActive: product.is_active,
    seasoning: !product.counts_in_calculation,
    confirmed: NO_CONFIRMED,
  };
}

/** Поля формы, у которых в источнике прочерк. */
export function unknownNutrients(product: Product | null): Nutrient[] {
  const unknown = product?.unknown_fields ?? [];
  return (Object.keys(NUTRIENT_FIELDS) as Nutrient[]).filter((nutrient) =>
    unknown.includes(NUTRIENT_FIELDS[nutrient]),
  );
}

/** Подтверждённые человеком поля — в тело правки и «Скорректировать». */
export function confirmedFields(
  values: ProductFormValues,
): (typeof NUTRIENT_FIELDS)[Nutrient][] {
  return (Object.keys(NUTRIENT_FIELDS) as Nutrient[])
    .filter((nutrient) => values.confirmed?.[nutrient] === true)
    .map((nutrient) => NUTRIENT_FIELDS[nutrient]);
}

/**
 * Значения формы — в тело `POST /products`.
 *
 * Флага активности здесь нет: новый продукт создаётся активным, снять флаг
 * можно правкой.
 */
export function toProductCreateBody(
  values: ProductFormValues,
): ProductCreateBody {
  const nameUz = values.nameUz.trim();
  const nameEn = values.nameEn.trim();

  return {
    name_ru: values.nameRu.trim(),
    name_uz: nameUz === "" ? null : nameUz,
    name_en: nameEn === "" ? null : nameEn,
    category_id: values.categoryId.trim(),
    kcal_100g: toPer100(values.kcal),
    fat_100g: toPer100(values.fat),
    protein_100g: toPer100(values.protein),
    carbs_100g: toPer100(values.carbs),
    fiber_100g: toPer100(values.fiber),
    source: values.source.trim(),
    source_version: values.sourceVersion.trim(),
    verified_at: values.verifiedAt,
    counts_in_calculation: !values.seasoning,
  };
}

/** Тело `PUT /products/{id}`: те же поля плюс флаг активности. */
export function toProductUpdateBody(
  values: ProductFormValues,
): ProductUpdateBody {
  return {
    ...toProductCreateBody(values),
    is_active: values.isActive,
    confirmed_fields: confirmedFields(values),
  };
}
