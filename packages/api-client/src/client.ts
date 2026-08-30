import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | undefined;
  /**
   * Обменивает httpOnly refresh-cookie на новый access-токен.
   *
   * Вызывается клиентом самостоятельно, когда ответ пришёл с 401. Возвращает
   * новый токен либо null, если обновить сессию не удалось.
   */
  refreshAccessToken?: () => Promise<string | null>;
  /** Сессия окончательно истекла: обновление не помогло. */
  onSessionExpired?: () => void;
}

/** Ручки, на которых обновляться бессмысленно: их 401 и означает «сессии нет». */
const NO_REFRESH = ["/api/v1/auth/login", "/api/v1/auth/refresh"];

export function createApiClient({
  baseUrl,
  getAccessToken,
  refreshAccessToken,
  onSessionExpired,
}: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl, credentials: "include" });

  /**
   * Одно обновление на все параллельные запросы.
   *
   * Экран открывает пять запросов сразу, и после истечения токена все пять
   * получают 401 одновременно. Без общего обещания они устроили бы пять
   * обновлений подряд: четыре из них предъявили бы уже использованную
   * refresh-cookie, а сервер по разделу 11 ТЗ вправе такую сессию оборвать.
   */
  let refreshing: Promise<string | null> | null = null;

  function refreshOnce(): Promise<string | null> {
    if (refreshAccessToken === undefined) return Promise.resolve(null);
    refreshing ??= refreshAccessToken().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  client.use({
    onRequest({ request }) {
      const token = getAccessToken?.();
      if (token) {
        request.headers.set("Authorization", `Bearer ${token}`);
      }
      return request;
    },

    /**
     * Продление сессии на лету (раздел 5.2 ТЗ: access живёт 15 минут, refresh —
     * 30 дней).
     *
     * До этого обновление происходило ровно один раз — при загрузке страницы, —
     * и через пятнадцать минут кабинет молча переставал работать: каждый запрос
     * отвечал 401, экраны показывали ошибку загрузки, а помогала только
     * перезагрузка. Врач на приёме и родитель, вносящий замер, натыкались на это
     * ежедневно.
     */
    async onResponse({ request, response, options }) {
      if (response.status !== 401) return;
      if (NO_REFRESH.some((path) => request.url.includes(path))) return;

      const token = await refreshOnce();
      if (token === null) {
        onSessionExpired?.();
        return;
      }

      // Повтор идёт напрямую через fetch, минуя мидлвари: иначе новый 401 снова
      // попал бы сюда, и обновление зациклилось бы.
      const retry = new Request(request, { headers: request.headers });
      retry.headers.set("Authorization", `Bearer ${token}`);
      return options.fetch(retry);
    },
  });

  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;
