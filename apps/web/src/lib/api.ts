import { createApiClient } from "@ketocare/api-client";

/**
 * Единственная точка обращения к API (раздел 8.4 ТЗ): ручных fetch во фронтенде
 * быть не должно — клиент генерируется из OpenAPI (`make openapi`).
 */
export const api = createApiClient({
  baseUrl: "",
  getAccessToken: () => accessToken ?? undefined,

  // Обновление сессии на лету: access живёт 15 минут, и без этого кабинет через
  // четверть часа молча переставал работать. Запрос делается «сырым» fetch, а
  // не через `api`, чтобы не уйти в рекурсию: обновление вызывается изнутри
  // обработки ответа самого клиента.
  refreshAccessToken: async () => {
    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) return null;

    const body: unknown = await response.json();
    const token =
      typeof body === "object" && body !== null && "access_token" in body
        ? (body as { access_token?: unknown }).access_token
        : undefined;
    if (typeof token !== "string") return null;

    setAccessToken(token);
    return token;
  },

  onSessionExpired: () => {
    setAccessToken(null);
    sessionExpiredHandlers.forEach((handler) => {
      handler();
    });
  },
});

/**
 * Подписка на окончательное истечение сессии.
 *
 * Модулем, а не контекстом React: клиент создаётся один раз на приложение и о
 * дереве компонентов ничего не знает, а увести пользователя на вход должен
 * именно провайдер сессии.
 */
const sessionExpiredHandlers = new Set<() => void>();

export function onSessionExpired(handler: () => void): () => void {
  sessionExpiredHandlers.add(handler);
  return () => sessionExpiredHandlers.delete(handler);
}

/**
 * Access-токен держится в памяти вкладки, а не в localStorage: XSS-скрипт читает
 * localStorage тривиально, а токен открывает клинические данные ребёнка.
 * Долгоживущий refresh лежит в httpOnly cookie, недоступной JavaScript, и после
 * перезагрузки сессия восстанавливается через POST /auth/refresh.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Код ошибки из ответа API (раздел 5.1 ТЗ), если тело соответствует контракту. */
export function errorCodeOf(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as ApiErrorBody).error?.code === "string"
  ) {
    return (body as ApiErrorBody).error.code;
  }
  return null;
}

/** Готовое к показу сообщение из ответа API — оно уже локализовано сервером. */
export function errorMessageOf(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as ApiErrorBody).error?.message === "string"
  ) {
    return (body as ApiErrorBody).error.message;
  }
  return null;
}
