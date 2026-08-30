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
  // «Ассистент» появится вместе со своей работой (этап 4). Пункт меню, за
  // которым ничего нет, хуже его отсутствия — правило П3 канона.
  parent: [
    "home",
    "menu",
    "diary",
    "calculator",
    "recipes",
    "products",
    "reports",
    "child",
    "profile",
  ],
  // «Главная» первой: вход вёл сразу в таблицу пациентов — полный реестр
  // вместо ответа на вопрос, с которого начинается рабочий день.
  doctor: ["home", "patients", "summaries", "profile"],
  dietitian: ["home", "patients", "products", "recipes", "profile"],
  admin: ["users", "products", "recipes", "dictionaries", "audit", "profile"],
};
