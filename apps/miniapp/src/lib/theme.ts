import type { Inset, ThemeParams } from "./telegram";
import { webApp } from "./telegram";

/**
 * Цвета Telegram → токены дизайн-системы (раздел 9 ТЗ).
 *
 * Mini App обязан выглядеть частью Telegram: у клиента свои темы, включая
 * пользовательские, и приложение со своим фоном читается как чужая страница
 * внутри мессенджера. Поэтому цвета берутся из `themeParams` — **но не
 * любой ценой**: требование контраста 4.5:1 (раздел 8.2 ТЗ) сильнее сходства с
 * клиентом. Типичный `hint_color` светлой темы — `#999999` на белом, 2.85:1;
 * `button_color` `#2481cc` как цвет текста — 4.1:1. Такой цвет не берётся, и
 * остаётся наш токен, выверенный `contrast.test.ts` в `packages/ui`.
 *
 * Успех, предупреждение и опасность-подложка остаются нашими всегда: тема
 * клиента их не описывает.
 */

/** Фон и карточка — подложки; их берём всегда, по ним проверяется текст. */
const SURFACE_BY_PARAM = {
  bg_color: "--color-background",
  secondary_bg_color: "--color-card",
} as const satisfies Partial<Record<keyof ThemeParams, string>>;

/** Всё, что этот модуль может переопределить, — чтобы снимать прежнее. */
const OVERRIDDEN_TOKENS = [
  "--color-background",
  "--color-card",
  "--color-foreground",
  "--color-muted-foreground",
  "--color-primary",
  "--color-primary-foreground",
  "--color-destructive",
] as const;

const MIN_CONTRAST = 4.5;

export function applyTelegramTheme(
  root: HTMLElement = document.documentElement,
): void {
  const app = webApp();
  if (app === null) return;

  // Тёмная тема — по признаку самого Telegram, а не по системному запросу:
  // человек мог выбрать в клиенте другую, и приложение должно быть с ней
  // заодно.
  root.dataset.theme = app.colorScheme === "dark" ? "dark" : "light";

  // Прежние переопределения снимаются: при смене темы клиента цвет, который
  // новая тема не прислала (или который теперь не проходит по контрасту),
  // остался бы от старой — светлый текст на светлом фоне.
  for (const token of OVERRIDDEN_TOKENS) root.style.removeProperty(token);

  const params = app.themeParams;
  for (const [param, token] of Object.entries(SURFACE_BY_PARAM)) {
    const value = hexOf(params[param as keyof ThemeParams]);
    if (value !== null) root.style.setProperty(token, value);
  }

  // Подложки, на которых будет стоять текст, — уже итоговые: клиентские или
  // наши (прочитанные после снятия переопределений, то есть по теме).
  const surfaces = [
    tokenValue(root, "--color-background"),
    tokenValue(root, "--color-card"),
  ];

  // Текстовые цвета — только если читаются на обеих подложках. Неизвестная
  // подложка (стили не загрузились) — не берём: проверить нечем.
  const readable = (color: string | null): color is string =>
    color !== null &&
    surfaces.every(
      (surface) =>
        surface !== null && contrastRatio(color, surface) >= MIN_CONTRAST,
    );

  const text = hexOf(params.text_color);
  if (readable(text)) root.style.setProperty("--color-foreground", text);

  const hint = hexOf(params.hint_color);
  if (readable(hint)) root.style.setProperty("--color-muted-foreground", hint);

  // Фирменный цвет — и текст (выбранная вкладка, ссылки), и подложка кнопки.
  // Берётся, только если годится в обеих ролях: читается на фонах и под
  // собственной подписью кнопки.
  const button = hexOf(params.button_color);
  const buttonText =
    hexOf(params.button_text_color) ??
    tokenValue(root, "--color-primary-foreground");
  if (
    readable(button) &&
    buttonText !== null &&
    contrastRatio(buttonText, button) >= MIN_CONTRAST
  ) {
    root.style.setProperty("--color-primary", button);
    root.style.setProperty("--color-primary-foreground", buttonText);
  }

  // Опасность — тоже и текст, и подложка под нашим `destructive-foreground`.
  const destructive = hexOf(params.destructive_text_color);
  const destructiveText = tokenValue(root, "--color-destructive-foreground");
  if (
    readable(destructive) &&
    destructiveText !== null &&
    contrastRatio(destructiveText, destructive) >= MIN_CONTRAST
  ) {
    root.style.setProperty("--color-destructive", destructive);
  }

  applySafeArea(root, app.safeAreaInset, app.contentSafeAreaInset);
}

/**
 * Безопасная зона: чёлка, домашняя полоса, вырезы по бокам в альбомной
 * ориентации — и поверх них шапка самого Telegram в полноэкранном режиме.
 *
 * Telegram отдаёт обе зоны числами, а не через `env(safe-area-inset-*)`:
 * приложение лежит во встроенном браузере, и системные переменные там
 * считаются от окна клиента, а не от экрана. Зоны складываются: системная
 * (`safeAreaInset`) отделяет от края экрана, зона клиента
 * (`contentSafeAreaInset`) — от его кнопок, лежащих уже внутри системной.
 */
function applySafeArea(
  root: HTMLElement,
  system: Inset | undefined,
  content: Inset | undefined,
): void {
  if (system === undefined && content === undefined) return;
  for (const side of ["top", "bottom", "left", "right"] as const) {
    const value = (system?.[side] ?? 0) + (content?.[side] ?? 0);
    root.style.setProperty(`--safe-${side}`, `${value}px`);
  }
}

/**
 * Подписка на смену темы и безопасной зоны: человек меняет тему, не выходя из
 * приложения, а зона меняется при повороте телефона и входе в полноэкранный
 * режим.
 */
export function watchTelegramTheme(): () => void {
  const app = webApp();
  if (app === null) return () => undefined;

  const handler = () => {
    applyTelegramTheme();
  };
  const events = ["themeChanged", "safeAreaChanged", "contentSafeAreaChanged"];
  for (const event of events) app.onEvent(event, handler);
  return () => {
    for (const event of events) app.offEvent(event, handler);
  };
}

/** `#rrggbb` или `null`: Telegram присылает и сокращённую запись, и пустоту. */
function hexOf(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(trimmed);
  if (short !== null) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  }
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : null;
}

/** Действующее значение токена — переопределённое или из `tokens.css`. */
function tokenValue(root: HTMLElement, token: string): string | null {
  return (
    hexOf(root.style.getPropertyValue(token)) ??
    hexOf(getComputedStyle(root).getPropertyValue(token))
  );
}

/** Относительная яркость по WCAG 2.1 — та же формула, что в `contrast.test.ts`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
