import type { Role } from "../auth/roles";

/**
 * Кому доступна правка справочника продуктов.
 *
 * Список повторяет `_EDITOR_ROLES` из `apps/api/src/api/routers/products.py`.
 * Это UX: право проверяет сервер (правило 5 CLAUDE.md), и обход проверки в
 * браузере ничего не даёт. Устроено так же, как `canEditRecipes` у рецептов —
 * та же пара ролей, тот же способ.
 */
const CATALOG_EDITOR_ROLES: readonly Role[] = ["admin", "dietitian"];

export function canEditCatalog(role: Role | undefined): boolean {
  return role !== undefined && CATALOG_EDITOR_ROLES.includes(role);
}

/**
 * Кому видно, кто и когда правил карточку продукта.
 *
 * Повторяет `_HISTORY_ROLES` из `apps/api/src/api/routers/products.py`. Само
 * содержимое справочника открыто всем ролям, а имена сотрудников рядом с
 * правками — сведения о работе клиники, и семье они не нужны ни для чего.
 * Это UX: право проверяет сервер (правило 5 CLAUDE.md).
 */
const HISTORY_ROLES: readonly Role[] = ["admin", "dietitian", "doctor"];

export function canSeeProductHistory(role: Role | undefined): boolean {
  return role !== undefined && HISTORY_ROLES.includes(role);
}
