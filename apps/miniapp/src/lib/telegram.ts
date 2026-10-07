/**
 * Всё, что приложение знает о Telegram, — в одном месте.
 *
 * Обёртка нужна не ради красоты: Mini App запускается и вне Telegram (открытая
 * в браузере ссылка, тест, локальная разработка), и там объекта `Telegram` нет
 * вовсе. Без единой точки каждый экран проверял бы это сам, а забытая проверка
 * роняет приложение целиком — в чужом браузере, у семьи на телефоне.
 *
 * Строку запуска читаем сами из адреса (`tgWebAppData`), SDK
 * `@telegram-apps/sdk-react` и `window.Telegram.WebApp` — запасные (см.
 * `launchData`). Цвета, безопасная зона, кнопка «Назад», подтверждение
 * закрытия и внешние ссылки — через `window.Telegram.WebApp`: у каждого
 * вызова здесь есть поведение вне Telegram, и экраны о нём не знают.
 */

import { retrieveRawInitData } from "@telegram-apps/sdk-react";

export interface ThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  destructive_text_color?: string;
}

export interface TelegramBackButton {
  show: () => void;
  hide: () => void;
  onClick: (handler: () => void) => void;
  offClick: (handler: () => void) => void;
}

export interface Inset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TelegramWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: ThemeParams;
  ready: () => void;
  expand: () => void;
  onEvent: (event: string, handler: () => void) => void;
  offEvent: (event: string, handler: () => void) => void;
  BackButton?: TelegramBackButton;
  /** Открыть ссылку t.me внутри Telegram, не закрывая приложение. */
  openTelegramLink?: (url: string) => void;
  /** Открыть внешнюю ссылку во внешнем браузере, не закрывая приложение. */
  openLink?: (url: string) => void;
  /** Bot API 6.2: спросить «закрыть?» перед закрытием приложения. */
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  /** Bot API 7.7: жест вниз сворачивает приложение — выключается на время ввода. */
  disableVerticalSwipes?: () => void;
  enableVerticalSwipes?: () => void;
  /** Зона системы: чёлка, домашняя полоса (Bot API 8.0). */
  safeAreaInset?: Inset;
  /** Зона самого Telegram поверх приложения: его шапка в полноэкранном режиме. */
  contentSafeAreaInset?: Inset;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function webApp(): TelegramWebApp | null {
  return typeof window === "undefined"
    ? null
    : (window.Telegram?.WebApp ?? null);
}

/**
 * Строка запуска или `null`, если приложение открыто не из Telegram.
 *
 * Пустая строка — тот же случай: Telegram отдаёт её, когда приложение открыто
 * по прямой ссылке, а не кнопкой в чате. Обменять такую строку на сессию
 * нельзя, и отличать её от отсутствия нечем.
 */
export function launchData(): string | null {
  // Три источника, и берётся первый непустой.
  //
  // Первым — свой разбор адреса, а не SDK. Причина не в недоверии, а в замере
  // на живом стенде: клиент Telegram передал параметры запуска в адресе
  // (`tgWebApp…` в хеше), а `retrieveRawInitData` строки не отдал — ни
  // исключением, ни значением. Приложение при этом объявляло себя открытым вне
  // Telegram, стоя ровно там, куда его привела кнопка «Приложение».
  //
  // Разбор адреса — три строки и никаких предположений о поведении библиотеки:
  // `tgWebAppData` в хеше и есть та самая подпись, которую проверяет сервер.
  return firstNonEmpty(fromAddress(), fromSdk(), webApp()?.initData);
}

/**
 * `tgWebAppData` из адреса страницы.
 *
 * Telegram кладёт параметры запуска в хеш (`#tgWebAppData=…&tgWebAppVersion=…`),
 * а в некоторых клиентах — в строку запроса. Смотрим оба места: пропустить
 * подпись там, где она есть, дороже лишней проверки.
 */
function fromAddress(): string | undefined {
  if (typeof window === "undefined") return undefined;

  for (const source of [
    window.location.hash.slice(1),
    window.location.search.slice(1),
  ]) {
    const value = new URLSearchParams(source).get("tgWebAppData");
    if (value !== null && value.length > 0) return value;
  }
  return undefined;
}

function fromSdk(): string | undefined {
  try {
    return retrieveRawInitData();
  } catch {
    // Открыто не из Telegram — это не сбой: экран объяснит, как привязать чат.
    return undefined;
  }
}

export interface LaunchDiagnosis {
  /** Есть ли `window.Telegram.WebApp` — то есть загрузился ли скрипт Telegram. */
  telegram: boolean;
  /** Отдал ли клиент строку запуска: она приходит либо в объекте, либо в адресе. */
  launchParams: boolean;
  /** Какие именно параметры запуска пришли — только имена, без значений. */
  keys: string;
}

/**
 * Почему приложение решило, что открыто не из Telegram.
 *
 * Показывается человеку одной строкой на экране отказа. Причин ровно две, и
 * лечатся они по-разному: нет объекта Telegram — не загрузился скрипт (сеть,
 * блокировка, старый клиент); объект есть, а параметров нет — страницу открыли
 * ссылкой, а не кнопкой «Приложение», и Telegram подпись не выдал.
 *
 * Без этой строки разбор превращается в переписку вслепую: снаружи оба случая
 * выглядят одинаково — «откройте кнопкой в чате».
 */
export function launchDiagnosis(): LaunchDiagnosis {
  const address =
    typeof window === "undefined"
      ? ""
      : `${window.location.hash} ${window.location.search}`;

  return {
    telegram: webApp() !== null,
    launchParams:
      address.includes("tgWebApp") || (webApp()?.initData ?? "").length > 0,
    // Имена параметров, и только имена: в значениях лежат подпись и данные
    // пользователя, а эта строка показывается на экране.
    keys: [...address.matchAll(/tgWebApp[A-Za-z]*/g)]
      .map((match) => match[0])
      .filter((name, index, all) => all.indexOf(name) === index)
      .join(", "),
  };
}

/**
 * Язык интерфейса Telegram (`user.language_code` в строке запуска) или `null`.
 *
 * Только умолчание до входа (ADR-0052): после входа язык приходит с сервера —
 * он свойство человека, и выбор, сделанный в боте, сильнее настройки клиента.
 * Строка не проверена подписью — для языка экрана это и не нужно: сервер
 * проверяет ту же строку сам, прежде чем что-то из неё сохранить.
 */
export function telegramLanguageCode(): string | null {
  const raw = launchData();
  if (raw === null) return null;
  try {
    const user: unknown = JSON.parse(
      new URLSearchParams(raw).get("user") ?? "",
    );
    if (typeof user !== "object" || user === null) return null;
    const code = (user as { language_code?: unknown }).language_code;
    return typeof code === "string" && code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

function firstNonEmpty(...values: (string | undefined)[]): string | null {
  for (const value of values) {
    if (value !== undefined && value.length > 0) return value;
  }
  return null;
}

/**
 * Запуск: `ready` убирает заставку Telegram, `expand` разворачивает окно на
 * всю высоту. Без первого приложение открывается в полупустом окне поверх
 * спиннера клиента. Зовёт `main.tsx` до первой отрисовки.
 */
export function initTelegram(): void {
  const app = webApp();
  app?.ready();
  app?.expand();
}

/**
 * Обработчики «Назад» стопкой: срабатывает только верхний.
 *
 * Вложенные состояния бывают вложены друг в друга — подтверждение удаления
 * поверх панели сборки дня поверх плана. У Telegram кнопка одна, и все
 * подписанные обработчики сработали бы разом: одно нажатие закрыло бы и
 * подтверждение, и панель. Стопка закрывает ровно то, что сверху.
 */
const backStack: (() => void)[] = [];
let backListener: (() => void) | null = null;

/**
 * Кнопка «Назад» самого Telegram на время жизни вложенного экрана.
 *
 * Без неё аппаратная «Назад» на Android закрывает весь Mini App: родитель,
 * открывший карточку рецепта, оказывался в чате вместо списка. Возвращает
 * уборку для `useEffect`; вне Telegram ничего не делает — там остаётся
 * внутренняя кнопка возврата.
 */
export function showBackButton(onBack: () => void): () => void {
  const button = webApp()?.BackButton;
  if (button === undefined) return () => undefined;

  backStack.push(onBack);
  if (backListener === null) {
    const listener = () => {
      backStack.at(-1)?.();
    };
    backListener = listener;
    button.onClick(listener);
  }
  button.show();
  return () => {
    const index = backStack.lastIndexOf(onBack);
    if (index !== -1) backStack.splice(index, 1);
    if (backStack.length === 0 && backListener !== null) {
      button.offClick(backListener);
      backListener = null;
      button.hide();
    }
  };
}

let unsavedCount = 0;

/**
 * На время незаконченного ввода: Telegram спрашивает «закрыть?», а жест вниз
 * не сворачивает приложение.
 *
 * Жест вниз по форме — обычная прокрутка, и до этого он сворачивал Mini App
 * вместе с наполовину записанным приступом. Выключается только на время ввода:
 * в остальное время свернуть приложение жестом — привычное поведение Telegram.
 * Счётчик, а не флаг: две открытые формы не должны снимать защиту друг у друга.
 */
export function guardUnsavedInput(): () => void {
  const app = webApp();
  if (app === null) return () => undefined;

  unsavedCount += 1;
  if (unsavedCount === 1) {
    app.enableClosingConfirmation?.();
    app.disableVerticalSwipes?.();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unsavedCount -= 1;
    if (unsavedCount === 0) {
      app.disableClosingConfirmation?.();
      app.enableVerticalSwipes?.();
    }
  };
}

/**
 * Внешняя ссылка (кабинет в браузере) — через Telegram.
 *
 * Обычный переход внутри Mini App открыл бы кабинет в окне приложения, где
 * человек не вошёл и откуда не вернуться в план дня. `openLink` уводит во
 * внешний браузер и оставляет приложение открытым. Вне Telegram — новая
 * вкладка.
 */
export function openExternalLink(url: string): void {
  const open = webApp()?.openLink;
  if (open !== undefined) {
    open(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Окно Telegram «Переслать»: человек выбирает чат из своего списка, и туда
 * уходит готовое сообщение со ссылкой (ADR-0043).
 *
 * Это тот же жест, которым он пересылает фотографии внукам, — ничего нового
 * учить не нужно. Вне Telegram ссылка открывается в новой вкладке: там
 * telegram.org предложит тот же выбор чата.
 */
export function shareToTelegram(url: string, text: string): void {
  const target =
    "https://t.me/share/url?url=" +
    encodeURIComponent(url) +
    "&text=" +
    encodeURIComponent(text);
  const open = webApp()?.openTelegramLink;
  if (open !== undefined) {
    open(target);
    return;
  }
  window.open(target, "_blank", "noopener,noreferrer");
}
