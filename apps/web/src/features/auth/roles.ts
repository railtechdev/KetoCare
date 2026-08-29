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
/**
 * Разделы, доступные по адресу, но не показываемые в боковой навигации.
 *
 * Свой профиль открывается из меню пользователя в шапке — так его ищут. В
 * боковом списке он занимал бы место наравне с рабочими разделами.
 */
export const SIDEBAR_HIDDEN_SECTIONS: readonly string[] = ["profile"];

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
    "profile",
  ],
  doctor: ["patients", "summaries", "profile"],
  dietitian: ["patients", "products", "recipes", "profile"],
  admin: ["users", "products", "recipes", "dictionaries", "audit", "profile"],
};
