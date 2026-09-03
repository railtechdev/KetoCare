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
  // Два источника, и берётся первый непустой.
  //
  // Раньше к `window.Telegram.WebApp` обращались только в `catch`, то есть
  // когда SDK БРОСИЛ исключение. Но он умеет и не бросать: вернуть пустую
  // строку или `undefined`, если строки запуска нет там, где он её ищет
  // (адрес, хеш, хранилище клиента). В этом случае запасной источник не
  // опрашивался вовсе, и приложение, открытое кнопкой в чате, объявляло себя
  // открытым вне Telegram — тупик, из которого семье не выйти.
  return firstNonEmpty(fromSdk(), webApp()?.initData);
}

function fromSdk(): string | undefined {
  try {
    return retrieveRawInitData();
  } catch {
    // Открыто не из Telegram — это не сбой: экран объяснит, как привязать чат.
    return undefined;
  }
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
