/**
 * Всё, что приложение знает о Telegram, — в одном месте.
 *
 * Обёртка нужна не ради красоты: Mini App запускается и вне Telegram (открытая
 * в браузере ссылка, тест, локальная разработка), и там объекта `Telegram` нет
 * вовсе. Без единой точки каждый экран проверял бы это сам, а забытая проверка
 * роняет приложение целиком — в чужом браузере, у семьи на телефоне.
 *
 * Строку запуска читаем сами из адреса (`tgWebAppData`), `window.Telegram.WebApp`
 * — запасной источник (см. `launchData`). Цвета, безопасная зона, кнопки
 * Telegram, вибрация, хранилище и внешние ссылки — через
 * `window.Telegram.WebApp`: у каждого вызова здесь есть поведение вне Telegram
 * и в старом клиенте, и экраны о нём не знают.
 *
 * **Каждая возможность новее Bot API 6.0 спрашивает `isVersionAtLeast`.**
 * Скрипт Telegram объявляет все методы в любом клиенте, а старый клиент на
 * вызов неизвестного метода не отвечает ничем: кнопка, обещанная внизу экрана,
 * просто не появилась бы, и форму стало бы нечем сохранить.
 */

export interface ThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  destructive_text_color?: string;
  /** Bot API 7.0: цвета родных экранов Telegram — разделы, подзаголовки, акцент. */
  section_bg_color?: string;
  section_header_text_color?: string;
  section_separator_color?: string;
  subtitle_text_color?: string;
  accent_text_color?: string;
  header_bg_color?: string;
  /** Bot API 7.10: полоса под нижними кнопками. */
  bottom_bar_bg_color?: string;
}

/** Нижняя кнопка Telegram (`MainButton` и, с 7.10, `SecondaryButton`). */
export interface TelegramBottomButton {
  setParams: (params: {
    text?: string;
    color?: string;
    text_color?: string;
    is_active?: boolean;
    is_visible?: boolean;
    position?: "left" | "right" | "top" | "bottom";
  }) => void;
  show: () => void;
  hide: () => void;
  showProgress: (leaveActive?: boolean) => void;
  hideProgress: () => void;
  onClick: (handler: () => void) => void;
  offClick: (handler: () => void) => void;
}

/** Пункт «Настройки» в меню приложения (Bot API 7.0). */
export interface TelegramSettingsButton {
  show: () => void;
  hide: () => void;
  onClick: (handler: () => void) => void;
  offClick: (handler: () => void) => void;
}

export interface TelegramHaptics {
  impactOccurred: (
    style: "light" | "medium" | "heavy" | "rigid" | "soft",
  ) => void;
  notificationOccurred: (type: "error" | "success" | "warning") => void;
  selectionChanged: () => void;
}

export interface TelegramCloudStorage {
  setItem: (
    key: string,
    value: string,
    callback?: (error: string | null, stored?: boolean) => void,
  ) => void;
  getItem: (
    key: string,
    callback: (error: string | null, value?: string) => void,
  ) => void;
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
  /** Версия Bot API, которую поддерживает клиент: «6.0» вне Telegram. */
  version?: string;
  isVersionAtLeast?: (version: string) => boolean;
  initDataUnsafe?: { start_param?: string };
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
  MainButton?: TelegramBottomButton;
  /** Bot API 7.10. */
  SecondaryButton?: TelegramBottomButton;
  /** Bot API 7.0. */
  SettingsButton?: TelegramSettingsButton;
  /** Bot API 6.1. */
  HapticFeedback?: TelegramHaptics;
  /** Bot API 6.9. */
  CloudStorage?: TelegramCloudStorage;
  /** Bot API 6.1; цвет числом — с 6.9. */
  setHeaderColor?: (color: string) => void;
  /** Bot API 6.1. */
  setBackgroundColor?: (color: string) => void;
  /** Bot API 7.10. */
  setBottomBarColor?: (color: string) => void;
  /** Bot API 9.1. */
  hideKeyboard?: () => void;
  close?: () => void;
  /** Bot API 8.0: ярлык приложения на главном экране телефона. */
  addToHomeScreen?: () => void;
  checkHomeScreenStatus?: (
    callback: (status: "unsupported" | "unknown" | "added" | "missing") => void,
  ) => void;
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
  // Первым — свой разбор адреса. Замер на живом стенде: клиент Telegram
  // передал параметры запуска в адресе (`tgWebApp…` в хеше), а библиотека
  // `@telegram-apps/sdk-react`, стоявшая здесь раньше, строки не отдала — ни
  // исключением, ни значением. Библиотека убрана (ADR-0075): она жила ради
  // одного запасного вызова, а `WebApp.initData` скрипта Telegram отвечает на
  // тот же вопрос.
  //
  // Разбор адреса — три строки и никаких предположений о поведении библиотеки:
  // `tgWebAppData` в хеше и есть та самая подпись, которую проверяет сервер.
  return firstNonEmpty(fromAddress(), webApp()?.initData);
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

/**
 * Поддерживает ли клиент эту версию Bot API.
 *
 * Вне Telegram — нет: скрипт Telegram на обычной странице объявляет себя
 * версией 6.0, и всё новее неё здесь считается отсутствующим.
 */
export function isVersionAtLeast(version: string): boolean {
  const app = webApp();
  if (app?.isVersionAtLeast === undefined) return false;
  try {
    return app.isVersionAtLeast(version);
  } catch {
    return false;
  }
}

/**
 * Вибрация-отклик (Bot API 6.1): отметка принята, запись сохранена, отказ.
 *
 * Отметку «съедено» ставят на ходу, не глядя в экран: короткий толчок говорит
 * «принято» раньше, чем человек посмотрит. Вне Telegram и в старом клиенте —
 * ничего.
 */
export function haptic(kind: "success" | "error" | "selection"): void {
  if (!isVersionAtLeast("6.1")) return;
  const feedback = webApp()?.HapticFeedback;
  if (feedback === undefined) return;
  try {
    if (kind === "selection") feedback.selectionChanged();
    else feedback.notificationOccurred(kind);
  } catch {
    // Вибрация — украшение: её отказ не должен ронять действие.
  }
}

/** Можно ли закрыть приложение кнопкой на экране — только внутри Telegram. */
export function canCloseApp(): boolean {
  const app = webApp();
  return app?.close !== undefined && launchData() !== null;
}

/** Закрыть приложение и вернуться в чат. */
export function closeApp(): void {
  webApp()?.close?.();
}

/**
 * Спрятать клавиатуру (Bot API 9.1) после выбора из поиска и после отправки.
 *
 * Без этого клавиатура закрывала половину экрана с только что выбранным
 * блюдом. В старом клиенте и вне Telegram — снять фокус с поля, что на
 * телефоне делает то же самое.
 */
export function hideKeyboard(): void {
  if (isVersionAtLeast("9.1")) {
    try {
      webApp()?.hideKeyboard?.();
      return;
    } catch {
      // Ниже — тот же результат обычным способом.
    }
  }
  const active =
    typeof document === "undefined" ? null : document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/**
 * Пункт «Настройки» в меню приложения (Bot API 7.0) на всё время жизни экранов.
 *
 * Возвращает уборку для `useEffect`. Вне Telegram и в старом клиенте пункта
 * нет — остаётся шестерёнка в шапке.
 */
export function showSettingsButton(onClick: () => void): () => void {
  const button = webApp()?.SettingsButton;
  if (button === undefined || !isVersionAtLeast("7.0")) return () => undefined;
  button.onClick(onClick);
  button.show();
  return () => {
    button.offClick(onClick);
    button.hide();
  };
}

/** Одна нижняя кнопка Telegram: подпись, действие и состояние. */
export interface BottomButtonSpec {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  /** Действие идёт: кнопка показывает ожидание и не нажимается. */
  progress?: boolean;
}

export interface BottomButtonsSpec {
  main: BottomButtonSpec;
  secondary?: BottomButtonSpec | null;
}

/**
 * Рисует ли приложение «Сохранить / Отмена» родными кнопками Telegram.
 *
 * Обе сразу или ни одной: `SecondaryButton` появился в Bot API 7.10, и форма,
 * у которой «Сохранить» внизу Telegram, а «Отмена» на странице, была бы
 * разорвана надвое. До 7.10 и вне Telegram обе кнопки стоят на странице.
 */
export function nativeBottomButtons(): boolean {
  const app = webApp();
  return (
    app?.MainButton !== undefined &&
    app.SecondaryButton !== undefined &&
    isVersionAtLeast("7.10")
  );
}

/**
 * Владельцы нижних кнопок стопкой — как у кнопки «Назад».
 *
 * Кнопки у Telegram две на всё приложение, а форм бывает открыто несколько:
 * форма записи дневника поверх экрана настроек. Кнопки принадлежат верхней;
 * закрылась она — возвращаются нижней.
 */
const bottomStack: { read: () => BottomButtonsSpec | null }[] = [];
let bottomListeners: { main: () => void; secondary: () => void } | null = null;

function topSpec(): BottomButtonsSpec | null {
  return bottomStack.at(-1)?.read() ?? null;
}

function clickOf(spec: BottomButtonSpec | null | undefined): void {
  if (spec == null || spec.disabled === true || spec.progress === true) return;
  spec.onClick();
}

function paint(
  button: TelegramBottomButton,
  spec: BottomButtonSpec | null | undefined,
  colors: { color?: string; text_color?: string },
): void {
  if (spec == null) {
    button.hide();
    return;
  }
  button.setParams({
    text: spec.text,
    is_visible: true,
    is_active: spec.disabled !== true,
    ...colors,
  });
  if (spec.progress === true) button.showProgress(false);
  else button.hideProgress();
}

/** Перерисовать нижние кнопки по верхнему владельцу стопки. */
export function refreshBottomButtons(): void {
  const app = webApp();
  if (app?.MainButton === undefined || app.SecondaryButton === undefined) {
    return;
  }
  const spec = topSpec();
  // Цвет кнопки — наш фирменный, уже проверенный по контрасту темой
  // (`theme.ts`): кнопка Telegram того же цвета, что кнопки на странице.
  paint(app.MainButton, spec?.main, chromeButtonColors());
  paint(app.SecondaryButton, spec?.secondary, {});
}

/**
 * Занять нижние кнопки, пока форма открыта. `read` спрашивается при каждом
 * нажатии и перерисовке, поэтому подпись и действие всегда текущие.
 */
export function pushBottomButtons(
  read: () => BottomButtonsSpec | null,
): () => void {
  const app = webApp();
  if (app?.MainButton === undefined || app.SecondaryButton === undefined) {
    return () => undefined;
  }
  const main = app.MainButton;
  const secondary = app.SecondaryButton;
  const entry = { read };
  bottomStack.push(entry);
  if (bottomListeners === null) {
    const listeners = {
      main: () => {
        clickOf(topSpec()?.main);
      },
      secondary: () => {
        clickOf(topSpec()?.secondary);
      },
    };
    bottomListeners = listeners;
    main.onClick(listeners.main);
    secondary.onClick(listeners.secondary);
  }
  refreshBottomButtons();
  return () => {
    const index = bottomStack.lastIndexOf(entry);
    if (index !== -1) bottomStack.splice(index, 1);
    if (bottomStack.length === 0 && bottomListeners !== null) {
      main.offClick(bottomListeners.main);
      secondary.offClick(bottomListeners.secondary);
      bottomListeners = null;
    }
    refreshBottomButtons();
  };
}

/** Цвет главной кнопки Telegram — фирменный цвет страницы. */
function chromeButtonColors(): { color?: string; text_color?: string } {
  if (typeof document === "undefined") return {};
  const style = getComputedStyle(document.documentElement);
  const color = style.getPropertyValue("--color-primary").trim();
  const text = style.getPropertyValue("--color-primary-foreground").trim();
  return /^#[0-9a-f]{6}$/i.test(color) && /^#[0-9a-f]{6}$/i.test(text)
    ? { color, text_color: text }
    : {};
}

/**
 * Шапка, фон и нижняя полоса Telegram — в цвет приложения.
 *
 * Без этого над приложением стояла шапка цвета чата, а под ним — полоса
 * другого серого: страница читалась как чужая вставка. Цвета берутся уже
 * итоговые (тема клиента, прошедшая проверку контраста, или наши).
 */
export function applyChromeColors(colors: {
  background: string | null;
  bar: string | null;
}): void {
  const app = webApp();
  if (app === null) return;
  try {
    if (colors.background !== null && isVersionAtLeast("6.9")) {
      app.setHeaderColor?.(colors.background);
    }
    if (colors.background !== null && isVersionAtLeast("6.1")) {
      app.setBackgroundColor?.(colors.background);
    }
    if (colors.bar !== null && isVersionAtLeast("7.10")) {
      app.setBottomBarColor?.(colors.bar);
    }
  } catch {
    // Цвет шапки — украшение: отказ клиента не должен ронять запуск.
  }
}

/**
 * Хранилище Telegram в облаке (Bot API 6.9): то же значение на телефоне и на
 * компьютере. Вне Telegram — `null`, и вызывающий берёт `localStorage`.
 */
export function cloudStorage(): TelegramCloudStorage | null {
  const storage = webApp()?.CloudStorage;
  return storage !== undefined && isVersionAtLeast("6.9") ? storage : null;
}

/**
 * Ярлык на главном экране телефона (Bot API 8.0).
 *
 * `onStatus` получает `true`, если предлагать есть что: клиент умеет, а ярлыка
 * ещё нет. Возвращает функцию, открывающую окно Telegram, или `null`.
 */
export function homeScreenShortcut(
  onStatus: (offer: boolean) => void,
): (() => void) | null {
  const app = webApp();
  if (
    app?.addToHomeScreen === undefined ||
    app.checkHomeScreenStatus === undefined ||
    !isVersionAtLeast("8.0")
  ) {
    onStatus(false);
    return null;
  }
  try {
    app.checkHomeScreenStatus((status) => {
      onStatus(status === "missing");
    });
  } catch {
    onStatus(false);
    return null;
  }
  return () => {
    app.addToHomeScreen?.();
  };
}
