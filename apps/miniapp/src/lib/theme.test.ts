import { afterEach, describe, expect, it } from "vitest";

import { applyTelegramTheme } from "./theme";
import type { TelegramWebApp } from "./telegram";

function fakeTelegram(app: Partial<TelegramWebApp>): void {
  window.Telegram = {
    WebApp: {
      initData: "",
      colorScheme: "light",
      themeParams: {},
      ready: () => undefined,
      expand: () => undefined,
      onEvent: () => undefined,
      offEvent: () => undefined,
      ...app,
    } as TelegramWebApp,
  };
}

afterEach(() => {
  delete window.Telegram;
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.theme;
});

describe("тема из Telegram", () => {
  it("берёт цвета клиента, а не свои", () => {
    // Приложение со своим фоном читается как чужая страница внутри мессенджера.
    fakeTelegram({
      themeParams: { bg_color: "#101820", text_color: "#f5f5f5" },
    });

    applyTelegramTheme();

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--color-background")).toBe("#101820");
    expect(root.style.getPropertyValue("--color-foreground")).toBe("#f5f5f5");
  });

  it("тёмная тема — по признаку клиента, а не по системному запросу", () => {
    // Человек мог выбрать в Telegram другую тему, чем в системе.
    fakeTelegram({ colorScheme: "dark" });

    applyTelegramTheme();

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("не трогает токены, которых в теме Telegram нет", () => {
    // Успех, предупреждение и опасность выверены по контрасту у нас
    // (`contrast.test.ts`), и клиент их не описывает.
    fakeTelegram({ themeParams: { bg_color: "#ffffff" } });

    applyTelegramTheme();

    expect(
      document.documentElement.style.getPropertyValue("--color-warning"),
    ).toBe("");
  });

  it("отступы безопасной зоны берутся числами от клиента", () => {
    // `env(safe-area-inset-*)` во встроенном браузере считается от окна
    // клиента, а не от экрана.
    fakeTelegram({ safeAreaInset: { top: 44, bottom: 34, left: 0, right: 0 } });

    applyTelegramTheme();

    expect(document.documentElement.style.getPropertyValue("--safe-top")).toBe(
      "44px",
    );
    expect(
      document.documentElement.style.getPropertyValue("--safe-bottom"),
    ).toBe("34px");
  });

  it("вне Telegram ничего не делает", () => {
    applyTelegramTheme();

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
