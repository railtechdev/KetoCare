/**
 * Всё, что приложение знает о Telegram, — в одном месте.
 *
 * Обёртка нужна не ради красоты: Mini App запускается и вне Telegram (открытая
 * в браузере ссылка, тест, локальная разработка), и там объекта `Telegram` нет
 * вовсе. Без единой точки каждый экран проверял бы это сам, а забытая проверка
 * роняет приложение целиком — в чужом браузере, у семьи на телефоне.
 *
 * Строку запуска достаёт `@telegram-apps/sdk-react` (раздел 2.3 ТЗ): Telegram
 * передаёт её по-разному — в адресе, в хеше, в хранилище клиента после
 * перезапуска, — и разбирать эти источники руками значит однажды не найти
 * строку там, где она есть. Цвета и безопасную зону берём из
 * `window.Telegram.WebApp`: это те же значения, но без монтирования сигналов
 * ради двух чисел.
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

export interface TelegramWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams: ThemeParams;
  ready: () => void;
  expand: () => void;
  onEvent: (event: string, handler: () => void) => void;
  offEvent: (event: string, handler: () => void) => void;
  BackButton?: TelegramBackButton;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
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

function firstNonEmpty(...values: (string | undefined)[]): string | null {
  for (const value of values) {
    if (value !== undefined && value.length > 0) return value;
  }
  return null;
}

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

  button.onClick(onBack);
  button.show();
  return () => {
    button.offClick(onBack);
    button.hide();
  };
}
