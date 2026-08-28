import type { components } from "@ketocare/api-client";

type Schemas = components["schemas"];

export type AdminUser = Schemas["UserRead"];
export type AdminUserUpdate = Schemas["AdminUserUpdate"];
export type AuditEntry = Schemas["AuditLogRead"];
export type DictionaryEntry = Schemas["DictionaryEntryRead"];
export type DictionaryEntryCreateBody = Schemas["DictionaryEntryCreate"];
export type DictionaryEntryUpdateBody = Schemas["DictionaryEntryUpdate"];
export type Product = Schemas["ProductRead"];
export type ProductCreateBody = Schemas["ProductCreate"];
export type ProductUpdateBody = Schemas["ProductUpdate"];
export type ImportReport = Schemas["ProductImportReport"];
export type ImportRowError = Schemas["ImportRowError"];

/**
 * Подразделы админки (раздел 8.1 ТЗ: users, products, recipes, dictionaries,
 * audit). Рецепты сюда не входят: их база общая с диетологом и живёт в разделе
 * `recipes`, а не в администрировании.
 */
export const ADMIN_SECTIONS = [
  "users",
  "products",
  "dictionaries",
  "audit",
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export function isAdminSection(value: string): value is AdminSection {
  return (ADMIN_SECTIONS as readonly string[]).includes(value);
}

/**
 * Верхняя граница страницы API (`MAX_PAGE_SIZE` в apps/api/deps/query.py):
 * запрос с большим `limit` сервер отклоняет как ошибку валидации.
 */
export const MAX_PAGE_SIZE = 200;

/** Значение `audit_log.entity` для правок продуктов — по нему строится история ревизий. */
export const PRODUCTS_AUDIT_ENTITY = "products";

export type ProductCategory = components["schemas"]["ProductCategoryRead"];
