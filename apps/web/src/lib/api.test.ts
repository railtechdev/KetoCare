import { NetworkError } from "@ketocare/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  errorMessageOf,
  getAccessToken,
  refreshAccessToken,
  SessionRefreshDeferred,
  setAccessToken,
} from "./api";

describe("объяснение отказа", () => {
  it("отказ сети называет связь, а не «что-то пошло не так»", () => {
    expect(errorMessageOf(new NetworkError())).toBe(
      "Нет связи. Проверьте интернет.",
    );
  });

  it("сообщение сервера отдаётся как есть", () => {
    expect(
      errorMessageOf({ error: { code: "conflict", message: "Уже есть." } }),
    ).toBe("Уже есть.");
  });

  it("ошибка в коде объяснения не получает", () => {
    expect(errorMessageOf(new TypeError("x is not a function"))).toBeNull();
  });
});

describe("обновление сессии посреди работы", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    setAccessToken(null);
  });

  function refreshAnswers(status: number, body: unknown = {}) {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;
  }

  it("«слишком часто» и сбой сервера — временный отказ, а не конец сессии", async () => {
    // Прежде оба давали «сессии нет», и клиент уводил человека посреди работы
    // на экран входа (аудит адаптации 27.11.2026, А11).
    for (const status of [429, 502]) {
      refreshAnswers(status);
      await expect(refreshAccessToken()).rejects.toBeInstanceOf(
        SessionRefreshDeferred,
      );
    }
  });

  it("отказ в сессии — конец сессии", async () => {
    refreshAnswers(401);
    await expect(refreshAccessToken()).resolves.toBeNull();
  });

  it("новый токен запоминается", async () => {
    refreshAnswers(200, { access_token: "fresh" });
    await expect(refreshAccessToken()).resolves.toBe("fresh");
    expect(getAccessToken()).toBe("fresh");
  });
});
