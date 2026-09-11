import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { connectivityListener, watchConnectivity } from "./connectivity";
import type { TelegramWebApp } from "./telegram";

function setNavigatorOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
}

/** Telegram с настоящей подпиской на события: обработчик можно вызвать. */
function fakeTelegram(): Map<string, () => void> {
  const handlers = new Map<string, () => void>();
  window.Telegram = {
    WebApp: {
      initData: "",
      colorScheme: "light",
      themeParams: {},
      ready: () => undefined,
      expand: () => undefined,
      onEvent: (event, handler) => {
        handlers.set(event, handler);
      },
      offEvent: (event) => {
        handlers.delete(event);
      },
    } as TelegramWebApp,
  };
  return handlers;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete window.Telegram;
});

describe("источник сети в Mini App", () => {
  it("спрашивает браузер сразу при подключении", () => {
    // Query стартует с «в сети»: открытое без сети приложение считало бы
    // себя подключённым до первого события.
    setNavigatorOnline(false);
    const setOnline = vi.fn();

    connectivityListener(setOnline);

    expect(setOnline).toHaveBeenLastCalledWith(false);
  });

  it("перепроверяет сеть, когда приложение снова на экране", () => {
    // WebView Telegram может не прислать `online` после возврата связи —
    // запросы остались бы на паузе при живой сети.
    setNavigatorOnline(false);
    const setOnline = vi.fn();
    connectivityListener(setOnline);

    setNavigatorOnline(true);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(setOnline).toHaveBeenLastCalledWith(true);
  });

  it("перепроверяет сеть по событию Telegram «activated»", () => {
    const handlers = fakeTelegram();
    setNavigatorOnline(false);
    const setOnline = vi.fn();
    connectivityListener(setOnline);

    setNavigatorOnline(true);
    handlers.get("activated")?.();

    expect(setOnline).toHaveBeenLastCalledWith(true);
  });

  it("слушает и обычные события online и offline", () => {
    setNavigatorOnline(true);
    const setOnline = vi.fn();
    connectivityListener(setOnline);

    window.dispatchEvent(new Event("offline"));
    expect(setOnline).toHaveBeenLastCalledWith(false);

    window.dispatchEvent(new Event("online"));
    expect(setOnline).toHaveBeenLastCalledWith(true);
  });

  it("снимает все слушатели при отключении", () => {
    const handlers = fakeTelegram();
    setNavigatorOnline(true);
    const setOnline = vi.fn();
    const cleanup = connectivityListener(setOnline);

    cleanup();
    setOnline.mockClear();
    window.dispatchEvent(new Event("offline"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(setOnline).not.toHaveBeenCalled();
    expect(handlers.has("activated")).toBe(false);
  });

  it("работает вне Telegram", () => {
    setNavigatorOnline(true);
    const setOnline = vi.fn();

    expect(() => connectivityListener(setOnline)()).not.toThrow();
  });

  it("watchConnectivity подключает источник к общему onlineManager", () => {
    // Без подключения модуль лежал бы рядом, а запросы Query слушали бы
    // стандартный источник — тот, что во WebView может не узнать о сети.
    setNavigatorOnline(true);
    watchConnectivity();
    const unsubscribe = onlineManager.subscribe(() => undefined);

    setNavigatorOnline(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onlineManager.isOnline()).toBe(false);

    setNavigatorOnline(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onlineManager.isOnline()).toBe(true);
    unsubscribe();
  });
});
