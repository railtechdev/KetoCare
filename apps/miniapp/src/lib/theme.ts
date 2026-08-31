import type { ThemeParams } from "./telegram";
import { webApp } from "./telegram";

/**
 * Цвета Telegram → токены дизайн-системы (раздел 9 ТЗ).
 *
 * Mini App обязан выглядеть частью Telegram: у клиента свои темы, включая
 * пользовательские, и приложение со своим фоном читается как чужая страница
 * внутри мессенджера. Поэтому цвета берутся из `themeParams`, а не задаются
 * здесь.
 *
 * Переопределяются только те токены, которым в Telegram есть точное
 * соответствие. Остальные — успех, предупреждение, опасность — остаются
 * нашими: их значения выверены по контрасту (`contrast.test.ts` в
 * `packages/ui`), а тема клиента их просто не описывает.
 */
const TOKEN_BY_PARAM: Partial<Record<keyof ThemeParams, string>> = {
  bg_color: "--color-background",
  text_color: "--color-foreground",
  secondary_bg_color: "--color-card",
  hint_color: "--color-muted-foreground",
  button_color: "--color-primary",
  button_text_color: "--color-primary-foreground",
  destructive_text_color: "--color-destructive",
};

export function applyTelegramTheme(
  root: HTMLElement = document.documentElement,
): void {
  const app = webApp();
  if (app === null) return;

  // Тёмная тема — по признаку самого Telegram, а не по системному запросу:
  // человек мог выбрать в клиенте другую, и приложение должно быть с ней
  // заодно.
  root.dataset.theme = app.colorScheme === "dark" ? "dark" : "light";

  for (const [param, token] of Object.entries(TOKEN_BY_PARAM)) {
    const value = app.themeParams[param as keyof ThemeParams];
    if (typeof value === "string" && value.length > 0) {
      root.style.setProperty(token, value);
    }
  }

  applySafeArea(root, app.safeAreaInset ?? app.contentSafeAreaInset);
}

/**
 * Безопасная зона: чёлка сверху, домашняя полоса снизу.
 *
 * Telegram отдаёт её числами, а не через `env(safe-area-inset-*)`: приложение
 * лежит во встроенном браузере, и системные переменные там считаются от окна
 * клиента, а не от экрана.
 */
function applySafeArea(
  root: HTMLElement,
  inset:
    { top: number; bottom: number; left: number; right: number } | undefined,
): void {
  if (inset === undefined) return;
  root.style.setProperty("--safe-top", `${inset.top}px`);
  root.style.setProperty("--safe-bottom", `${inset.bottom}px`);
  root.style.setProperty("--safe-left", `${inset.left}px`);
  root.style.setProperty("--safe-right", `${inset.right}px`);
}

/** Подписка на смену темы в клиенте: человек меняет её, не выходя из приложения. */
export function watchTelegramTheme(): () => void {
  const app = webApp();
  if (app === null) return () => undefined;

  const handler = () => {
    applyTelegramTheme();
  };
  app.onEvent("themeChanged", handler);
  return () => {
    app.offEvent("themeChanged", handler);
  };
}
