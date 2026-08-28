import type { components } from "@ketocare/api-client";

import type { Role } from "../auth/roles";

export type Recipe = components["schemas"]["RecipeRead"];
export type RecipeWriteBody = components["schemas"]["RecipeWrite"];
export type RecipeCategory = components["schemas"]["RecipeCategory"];
export type RecipeStatus = components["schemas"]["RecipeStatus"];

/**
 * Категории рецептов (раздел 4.2 ТЗ).
 *
 * `satisfies` связывает список с типом из OpenAPI: если сервер добавит или
 * переименует категорию, расхождение поймает компилятор, а не пользователь,
 * увидевший пустой фильтр.
 */
export const RECIPE_CATEGORIES = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "dessert",
  "drink",
] as const satisfies readonly RecipeCategory[];

/**
 * Роли, которым доступна правка базы рецептов (раздел 5.3 ТЗ).
 *
 * Скрытие кнопок — только UX: сами ручки закрыты `require_roles` на сервере
 * (правило 5 CLAUDE.md), и обход проверки в браузере ничего не даёт.
 */
const RECIPE_EDITOR_ROLES: readonly Role[] = ["admin", "dietitian"];

export function canEditRecipes(role: Role | undefined): boolean {
  return role !== undefined && RECIPE_EDITOR_ROLES.includes(role);
}

export interface RecipeFilters {
  q: string;
  /** Пустая строка — категория не выбрана */
  category: RecipeCategory | "";
  /**
   * Границы соотношения хранятся строками, а не числами: пустое поле означает
   * отсутствие границы, а числовое состояние не отличило бы его от нуля.
   */
  ratioMin: string;
  ratioMax: string;
  limit: number;
}

export const RECIPES_PAGE_SIZE = 24;

export const EMPTY_RECIPE_FILTERS: RecipeFilters = {
  q: "",
  category: "",
  ratioMin: "",
  ratioMax: "",
  limit: RECIPES_PAGE_SIZE,
};

/** Граница диапазона из поля ввода. `null` — граница не задана или введена не как число. */
export function parseRatioBound(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const parsed = Number(trimmed);
  // Отрицательное соотношение сервер отклонит (ge=0), поэтому такой ввод
  // трактуется как отсутствие границы, а не как фильтр, ничего не находящий.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Начало диапазона больше конца: запрос заведомо пуст, отправлять его незачем. */
export function isRatioRangeInvalid(filters: RecipeFilters): boolean {
  const min = parseRatioBound(filters.ratioMin);
  const max = parseRatioBound(filters.ratioMax);
  return min !== null && max !== null && min > max;
}

export interface RecipeSearchQuery {
  q?: string;
  category?: RecipeCategory;
  ratio_min?: number;
  ratio_max?: number;
  limit: number;
  offset: number;
}

/**
 * Фильтры экрана — в параметры `GET /recipes`.
 *
 * Незаполненные фильтры не попадают в запрос вовсе: пустая строка в `q`
 * ушла бы в полнотекстовый поиск и отсекла бы всю выдачу.
 */
export function toRecipeSearchQuery(filters: RecipeFilters): RecipeSearchQuery {
  const query: RecipeSearchQuery = { limit: filters.limit, offset: 0 };

  const q = filters.q.trim();
  if (q !== "") query.q = q;
  if (filters.category !== "") query.category = filters.category;

  const ratioMin = parseRatioBound(filters.ratioMin);
  if (ratioMin !== null) query.ratio_min = ratioMin;

  const ratioMax = parseRatioBound(filters.ratioMax);
  if (ratioMax !== null) query.ratio_max = ratioMax;

  return query;
}
