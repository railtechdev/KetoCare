import type { DefaultValues } from "react-hook-form";
import { z } from "zod";

import type { Product, ProductCreateBody, ProductUpdateBody } from "./types";

const requiredText = z.string().trim().min(1);

/** Пищевая ценность на 100 г: отрицательной не бывает, ноль допустим (вода, соль). */
const per100g = z.number().nonnegative();

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
  categoryId: z.string().trim().uuid(),
  kcal: per100g,
  fat: per100g,
  protein: per100g,
  carbs: per100g,
  fiber: per100g,
  source: requiredText,
  sourceVersion: requiredText,
  /** `<input type="date">` отдаёт ISO-дату; пустое поле не проходит проверку */
  verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isActive: z.boolean(),
});

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
};

export function toProductFormValues(product: Product): ProductFormValues {
  return {
    nameRu: product.name_ru,
    nameUz: product.name_uz ?? "",
    nameEn: product.name_en ?? "",
    categoryId: product.category_id,
    kcal: product.kcal_100g,
    fat: product.fat_100g,
    protein: product.protein_100g,
    carbs: product.carbs_100g,
    fiber: product.fiber_100g,
    source: product.source,
    sourceVersion: product.source_version,
    verifiedAt: product.verified_at,
    isActive: product.is_active,
  };
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
    kcal_100g: values.kcal,
    fat_100g: values.fat,
    protein_100g: values.protein,
    carbs_100g: values.carbs,
    fiber_100g: values.fiber,
    source: values.source.trim(),
    source_version: values.sourceVersion.trim(),
    verified_at: values.verifiedAt,
  };
}

/** Тело `PUT /products/{id}`: те же поля плюс флаг активности. */
export function toProductUpdateBody(
  values: ProductFormValues,
): ProductUpdateBody {
  return { ...toProductCreateBody(values), is_active: values.isActive };
}
