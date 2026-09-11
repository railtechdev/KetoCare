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
  it("не уводит в офлайн по navigator.onLine", () => {
    // `navigator.onLine === false` бывает ложным. Поверить ему значит создать
    // ровно тот отказ, который этот источник чинит: пауза при живой связи.
    setNavigatorOnline(false);
    const setOnline = vi.fn();

    connectivityListener(setOnline);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(setOnline).not.toHaveBeenCalledWith(false);
  });

  it("перепроверяет сеть, когда приложение снова на экране", () => {
    // WebView Telegram может не прислать `online` после возврата связи —
    // запросы остались бы на паузе при живой сети.
    setNavigatorOnline(false);
    const setOnline = vi.fn();
    connectivityListener(setOnline);
    window.dispatchEvent(new Event("offline"));

    setNavigatorOnline(true);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(setOnline).toHaveBeenLastCalledWith(true);
  });

  it("перепроверяет сеть по событию Telegram «activated»", () => {
    const handlers = fakeTelegram();
    setNavigatorOnline(false);
    const setOnline = vi.fn();
    connectivityListener(setOnline);
    window.dispatchEvent(new Event("offline"));

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

    try {
      window.dispatchEvent(new Event("offline"));
      expect(onlineManager.isOnline()).toBe(false);

      document.dispatchEvent(new Event("visibilitychange"));
      expect(onlineManager.isOnline()).toBe(true);
    } finally {
      unsubscribe();
      onlineManager.setOnline(true);
    }
  });
});
