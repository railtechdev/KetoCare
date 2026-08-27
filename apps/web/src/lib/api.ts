import { createApiClient } from "@ketocare/api-client";

/**
 * Единственная точка обращения к API (раздел 8.4 ТЗ): ручных fetch во фронтенде
 * быть не должно — клиент генерируется из OpenAPI (`make openapi`).
 */
export const api = createApiClient({
  baseUrl: "",
  getAccessToken: () => accessToken ?? undefined,
});

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
