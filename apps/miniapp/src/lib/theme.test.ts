import { afterEach, describe, expect, it } from "vitest";

import { applyTelegramTheme, contrastRatio, watchTelegramTheme } from "./theme";
import type { TelegramWebApp } from "./telegram";

function fakeTelegram(app: Partial<TelegramWebApp>): TelegramWebApp {
  const webApp = {
    initData: "",
    colorScheme: "light",
    themeParams: {},
    ready: () => undefined,
    expand: () => undefined,
    onEvent: () => undefined,
    offEvent: () => undefined,
    ...app,
  } as TelegramWebApp;
  window.Telegram = { WebApp: webApp };
  return webApp;
}

const root = document.documentElement;
const tokenOf = (name: string) => root.style.getPropertyValue(name);

/** Тема Telegram для iOS, светлая — как её присылает клиент. */
const IOS_LIGHT = {
  bg_color: "#ffffff",
  secondary_bg_color: "#efeff3",
  text_color: "#000000",
  hint_color: "#999999",
  link_color: "#2481cc",
  button_color: "#2481cc",
  button_text_color: "#ffffff",
  destructive_text_color: "#ff3b30",
};

/** Ночная тема Telegram Desktop / Android. */
const NIGHT = {
  bg_color: "#212121",
  secondary_bg_color: "#0f0f0f",
  text_color: "#ffffff",
  hint_color: "#aaaaaa",
  link_color: "#8774e1",
  button_color: "#8774e1",
  button_text_color: "#ffffff",
  destructive_text_color: "#ff595a",
};

/** Ночная синяя тема iOS. */
const NIGHT_BLUE = {
  bg_color: "#18222d",
  secondary_bg_color: "#131415",
  text_color: "#ffffff",
  hint_color: "#b1c3d5",
  button_color: "#2ea6ff",
  button_text_color: "#ffffff",
};

afterEach(() => {
  delete window.Telegram;
  root.removeAttribute("style");
  delete root.dataset.theme;
});

describe("тема из Telegram", () => {
  it("берёт фон и текст клиента, а не свои", () => {
    // Приложение со своим фоном читается как чужая страница внутри мессенджера.
    fakeTelegram({
      themeParams: { bg_color: "#101820", text_color: "#f5f5f5" },
    });

    applyTelegramTheme();

    expect(tokenOf("--color-background")).toBe("#101820");
    // Карточки клиент не прислал, а наш токен в тесте не загружен — проверить
    // текст не на чем, и он остаётся нашим.
    expect(tokenOf("--color-foreground")).toBe("");
  });

  it("тёмная тема — по признаку клиента, а не по системному запросу", () => {
    // Человек мог выбрать в Telegram другую тему, чем в системе.
    fakeTelegram({ colorScheme: "dark" });

    applyTelegramTheme();

    expect(root.dataset.theme).toBe("dark");
  });

  it("не трогает токены, которых в теме Telegram нет", () => {
    // Успех, предупреждение и опасность выверены по контрасту у нас
    // (`contrast.test.ts`), и клиент их не описывает.
    fakeTelegram({ themeParams: IOS_LIGHT });

    applyTelegramTheme();

    expect(tokenOf("--color-warning")).toBe("");
  });

  describe("контраст 4.5:1 сильнее сходства с клиентом", () => {
    it("светлая iOS: подсказка #999 на белом (2.85:1) не берётся", () => {
      fakeTelegram({ themeParams: IOS_LIGHT });

      applyTelegramTheme();

      expect(tokenOf("--color-background")).toBe("#ffffff");
      expect(tokenOf("--color-card")).toBe("#efeff3");
      expect(tokenOf("--color-foreground")).toBe("#000000");
      expect(tokenOf("--color-muted-foreground")).toBe("");
      // #2481cc как цвет текста на белом — 4.1:1.
      expect(tokenOf("--color-primary")).toBe("");
      expect(tokenOf("--color-primary-foreground")).toBe("");
      // #ff3b30 на белом — 3.5:1.
      expect(tokenOf("--color-destructive")).toBe("");
    });

    it("ночная тема: читаемая подсказка берётся, фиолетовая кнопка — нет", () => {
      fakeTelegram({ colorScheme: "dark", themeParams: NIGHT });

      applyTelegramTheme();

      expect(tokenOf("--color-foreground")).toBe("#ffffff");
      expect(tokenOf("--color-muted-foreground")).toBe("#aaaaaa");
      // #8774e1 на #212121 — 4.3:1: выбранная вкладка читалась бы плохо.
      expect(tokenOf("--color-primary")).toBe("");
    });

    it("синяя ночная iOS: белая подпись на голубой кнопке (2.6:1) не берётся", () => {
      fakeTelegram({ colorScheme: "dark", themeParams: NIGHT_BLUE });

      applyTelegramTheme();

      expect(tokenOf("--color-muted-foreground")).toBe("#b1c3d5");
      expect(tokenOf("--color-primary")).toBe("");
    });

    it("кнопка, годная и текстом, и подложкой, берётся вместе с подписью", () => {
      fakeTelegram({
        themeParams: {
          ...IOS_LIGHT,
          button_color: "#1a5fb4",
          button_text_color: "#ffffff",
        },
      });

      applyTelegramTheme();

      expect(tokenOf("--color-primary")).toBe("#1a5fb4");
      expect(tokenOf("--color-primary-foreground")).toBe("#ffffff");
    });

    it("каждый взятый текстовый цвет проходит 4.5:1 на фоне и карточке", () => {
      for (const params of [IOS_LIGHT, NIGHT, NIGHT_BLUE]) {
        fakeTelegram({ themeParams: params });
        applyTelegramTheme();
        for (const token of [
          "--color-foreground",
          "--color-muted-foreground",
          "--color-primary",
        ]) {
          const color = tokenOf(token);
          if (color === "") continue;
          for (const surface of ["--color-background", "--color-card"]) {
            expect(
              contrastRatio(color, tokenOf(surface)),
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
        root.removeAttribute("style");
      }
    });
  });

  it("смена темы снимает прежние переопределения", () => {
    // Светлый текст ночной темы на белом фоне дневной — если бы остался.
    const handlers = new Map<string, () => void>();
    const app = fakeTelegram({
      colorScheme: "dark",
      themeParams: NIGHT,
      onEvent: (event, handler) => void handlers.set(event, handler),
    });
    const stop = watchTelegramTheme();
    applyTelegramTheme();
    expect(tokenOf("--color-muted-foreground")).toBe("#aaaaaa");

    app.colorScheme = "light";
    app.themeParams = { bg_color: "#ffffff", secondary_bg_color: "#efeff3" };
    handlers.get("themeChanged")?.();

    expect(root.dataset.theme).toBe("light");
    expect(tokenOf("--color-muted-foreground")).toBe("");
    expect(tokenOf("--color-foreground")).toBe("");
    stop();
  });

  it("безопасная зона — сумма системной и зоны клиента, со всех сторон", () => {
    // `env(safe-area-inset-*)` во встроенном браузере считается от окна
    // клиента, а не от экрана; в полноэкранном режиме поверх системной зоны
    // лежит ещё шапка Telegram.
    fakeTelegram({
      safeAreaInset: { top: 44, bottom: 34, left: 12, right: 0 },
      contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 8 },
    });

    applyTelegramTheme();

    expect(tokenOf("--safe-top")).toBe("90px");
    expect(tokenOf("--safe-bottom")).toBe("34px");
    expect(tokenOf("--safe-left")).toBe("12px");
    expect(tokenOf("--safe-right")).toBe("8px");
  });

  it("зона пересчитывается при её изменении клиентом", () => {
    const handlers = new Map<string, () => void>();
    const app = fakeTelegram({
      safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
      onEvent: (event, handler) => void handlers.set(event, handler),
    });
    const stop = watchTelegramTheme();

    app.safeAreaInset = { top: 0, bottom: 0, left: 44, right: 44 };
    handlers.get("safeAreaChanged")?.();
    expect(tokenOf("--safe-left")).toBe("44px");

    app.contentSafeAreaInset = { top: 50, bottom: 0, left: 0, right: 0 };
    handlers.get("contentSafeAreaChanged")?.();
    expect(tokenOf("--safe-top")).toBe("50px");
    stop();
  });

  it("вне Telegram ничего не делает", () => {
    applyTelegramTheme();

    expect(root.dataset.theme).toBeUndefined();
  });
});
