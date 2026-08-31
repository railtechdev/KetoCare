import { createApiClient } from "@ketocare/api-client";

/**
 * Единственная точка обращения к API. Ручных `fetch` в экранах быть не должно —
 * клиент генерируется из OpenAPI (`make openapi`). Единственное исключение —
 * обновление токена ниже: оно вызывается изнутри обработки ответа самого
 * клиента, и вызов через него ушёл бы в рекурсию (так же сделано в кабинете).
 *
 * Отличие от кабинета — где живут токены. В кабинете refresh лежит в httpOnly
 * cookie; во встроенном браузере Telegram сторонние cookie не выживают, и
 * раздел 5.2 ТЗ прямо говорит: «для Mini App — заголовок». Оба токена держатся
 * в памяти вкладки и нигде не сохраняются: localStorage читается любым
 * XSS-скриптом, а токен открывает клинические данные ребёнка. После
 * перезагрузки сессия начинается заново — строку запуска Telegram отдаёт
 * приложению при каждом открытии.
 */
export const api = createApiClient({
  baseUrl: "",
  getAccessToken: () => tokens?.access ?? undefined,

  refreshAccessToken: async () => {
    const refresh = tokens?.refresh;
    if (refresh === undefined) return null;

    const response = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!response.ok) return null;

    const body: unknown = await response.json();
    const pair = asTokens(body);
    if (pair === null) return null;

    setTokens(pair);
    return pair.access;
  },

  onSessionExpired: () => {
    setTokens(null);
    sessionExpiredHandlers.forEach((handler) => {
      handler();
    });
  },
});

export interface Tokens {
  access: string;
  refresh: string;
}

let tokens: Tokens | null = null;

export function setTokens(next: Tokens | null): void {
  tokens = next;
}

export function getTokens(): Tokens | null {
  return tokens;
}

function asTokens(body: unknown): Tokens | null {
  if (typeof body !== "object" || body === null) return null;
  const { access_token: access, refresh_token: refresh } = body as {
    access_token?: unknown;
    refresh_token?: unknown;
  };
  if (typeof access !== "string" || typeof refresh !== "string") return null;
  return { access, refresh };
}

const sessionExpiredHandlers = new Set<() => void>();

export function onSessionExpired(handler: () => void): () => void {
  sessionExpiredHandlers.add(handler);
  return () => sessionExpiredHandlers.delete(handler);
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Код ошибки из ответа API (раздел 5.1 ТЗ), если тело соответствует контракту. */
export function errorCodeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body))
    return null;
  const { error } = body as { error?: { code?: unknown } };
  return typeof error?.code === "string" ? error.code : null;
}

/** Человеческое сообщение из ответа API — его пишет сервер, и оно на русском. */
export function errorMessageOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body))
    return null;
  const { error } = body as { error?: { message?: unknown } };
  return typeof error?.message === "string" ? error.message : null;
}
