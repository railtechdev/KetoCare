import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "./client";

/**
 * Продление сессии на лету.
 *
 * До него обновление токена происходило ровно один раз — при загрузке
 * страницы, — и через пятнадцать минут кабинет молча переставал работать:
 * каждый запрос отвечал 401, экраны показывали ошибку загрузки, а помогала
 * только перезагрузка. Ни один тест этого не ловил, потому что тесты экранов
 * подменяют `api` целиком.
 */
describe("клиент API: продление сессии", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  function jsonResponse(
    body: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  /**
   * 401 от проверки токена — такой, какой отдаёт сервер: с `WWW-Authenticate`.
   * Отказ по существу запроса (неверный текущий пароль) заголовка не несёт, и
   * ниже это отдельный случай.
   */
  function unauthorized(status = 401) {
    return jsonResponse({ error: { code: "unauthorized" } }, status, {
      "WWW-Authenticate": "Bearer",
    });
  }

  it("обновляет токен по 401 и повторяет запрос", async () => {
    let token = "old-token";
    const seen: (string | null)[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      const auth = request.headers.get("Authorization");
      seen.push(auth);
      return auth === "Bearer new-token"
        ? jsonResponse({ items: [], total: 0 })
        : unauthorized();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const api = createApiClient({
      baseUrl: "http://test",
      getAccessToken: () => token,
      refreshAccessToken: async () => {
        token = "new-token";
        return token;
      },
    });

    const { data } = await api.GET("/api/v1/patients", {});

    expect(data).toEqual({ items: [], total: 0 });
    expect(seen).toEqual(["Bearer old-token", "Bearer new-token"]);
  });

  it("на все параллельные 401 приходится одно обновление", async () => {
    // Экран открывает несколько запросов сразу, и после истечения токена все
    // они получают 401 одновременно. Без общего обещания каждый устроил бы своё
    // обновление, предъявив уже использованную refresh-cookie.
    let token = "old-token";
    let refreshes = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const auth = (input as Request).headers.get("Authorization");
      return auth === "Bearer new-token"
        ? jsonResponse({ items: [], total: 0 })
        : unauthorized();
    }) as unknown as typeof fetch;

    const api = createApiClient({
      baseUrl: "http://test",
      getAccessToken: () => token,
      refreshAccessToken: async () => {
        refreshes += 1;
        await Promise.resolve();
        token = "new-token";
        return token;
      },
    });

    await Promise.all([
      api.GET("/api/v1/patients", {}),
      api.GET("/api/v1/patients", {}),
      api.GET("/api/v1/patients", {}),
    ]);

    expect(refreshes).toBe(1);
  });

  it("не обновляется на самом входе и на самом обновлении", async () => {
    // Иначе 401 от `/auth/login` («неверный пароль») запускал бы обновление, а
    // 401 от `/auth/refresh` — бесконечную рекурсию.
    const refresh = vi.fn(async () => "new-token");

    globalThis.fetch = vi.fn(async () =>
      unauthorized(),
    ) as unknown as typeof fetch;

    const api = createApiClient({
      baseUrl: "http://test",
      getAccessToken: () => "old-token",
      refreshAccessToken: refresh,
    });

    await api.POST("/api/v1/auth/login", {
      body: { email: "a@b.c", password: "x" },
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("сообщает об окончательном истечении, когда обновиться не удалось", async () => {
    const expired = vi.fn();

    globalThis.fetch = vi.fn(async () =>
      unauthorized(),
    ) as unknown as typeof fetch;

    const api = createApiClient({
      baseUrl: "http://test",
      getAccessToken: () => "old-token",
      refreshAccessToken: async () => null,
      onSessionExpired: expired,
    });

    await api.GET("/api/v1/patients", {});

    expect(expired).toHaveBeenCalledOnce();
  });
  it("не обновляет сессию, когда 401 — отказ по существу запроса", async () => {
    // Смена пароля отвечает 401 с текстом «Текущий пароль указан неверно» —
    // это не протухший токен. Обновление здесь повторяло запрос, получало тот
    // же отказ и теряло его сообщение: человек видел «что-то пошло не так»
    // вместо причины. А когда обновиться не удавалось, опечатка в своём же
    // пароле ещё и выбрасывала из кабинета.
    const refresh = vi.fn(async () => "new-token");
    const expired = vi.fn();
    let calls = 0;

    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return jsonResponse(
        {
          error: {
            code: "unauthorized",
            message: "Текущий пароль указан неверно.",
          },
        },
        401,
      );
    }) as unknown as typeof fetch;

    const api = createApiClient({
      baseUrl: "http://test",
      getAccessToken: () => "token",
      refreshAccessToken: refresh,
      onSessionExpired: expired,
    });

    const { error } = await api.POST("/api/v1/users/me/password", {
      body: {
        current_password: "wrong",
        new_password: "new secure passphrase",
      },
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(expired).not.toHaveBeenCalled();
    expect(calls).toBe(1);
    // Конверт ошибки в сгенерированных типах не описан (он общий для всего API,
    // а не для ручки), поэтому читается так же, как в кабинете — сужением из
    // `unknown`; см. `errorMessageOf` в `apps/web/src/lib/api.ts`.
    const body = error as { error?: { message?: string } } | undefined;
    expect(body?.error?.message).toBe("Текущий пароль указан неверно.");
  });
});
