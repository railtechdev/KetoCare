/** Роли пользователей (раздел 4.2 ТЗ). */
export const ROLES = ["admin", "doctor", "dietitian", "parent"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" && (ROLES as readonly string[]).includes(value)
  );
}

/**
 * Разделы, доступные роли (раздел 8.1 ТЗ).
 *
 * Это UX, а не безопасность: доступ проверяет сервер (правило 5 CLAUDE.md).
 * Здесь только чтобы не показывать заведомо недоступные пункты меню.
 */
export const SECTIONS_BY_ROLE: Record<Role, readonly string[]> = {
  parent: [
    "home",
    "calculator",
    "products",
    "recipes",
    "menu",
    "diary",
    "reports",
    "assistant",
    "settings",
  ],
  doctor: ["patients", "summaries"],
  dietitian: ["patients", "products", "recipes"],
  admin: ["users", "products", "recipes", "dictionaries", "audit"],
};
