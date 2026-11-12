import type { CreatableKind } from "../features/diary/useDiary";
import type { TabId } from "./tabs";
import { launchData, webApp } from "./telegram";

/**
 * Куда открыть приложение — параметр запуска (ADR-0075).
 *
 * Бот ставит под напоминанием кнопку, которая открывает приложение сразу на
 * нужной форме: «кетоны не записаны» → форма кетонов, а не главная, с которой
 * до формы ещё три нажатия. Договор с ботом — значения ниже, и только они;
 * незнакомое значение открывает главную, а не ошибку: бот может оказаться
 * новее приложения.
 */
export const LAUNCH_VALUES = [
  "today",
  "menu",
  "diary",
  "diary-seizures",
  "diary-ketones",
  "diary-weight",
  "diary-medications",
  "diary-side-effects",
  "settings",
  "family",
  "reminders",
] as const;

export type LaunchValue = (typeof LAUNCH_VALUES)[number];

/** Раздел настроек, к которому прокручивается экран. */
export type SettingsSection = "family" | "reminders";

/** Что открыть: вкладку, экран внутри неё или настройки. */
export type LaunchTarget =
  | { tab: "today"; view?: "menu"; dayOffset?: number }
  | { tab: "diary"; addKind?: CreatableKind }
  | { tab: Exclude<TabId, "today" | "diary"> }
  | { settings: true; section?: SettingsSection };

const DIARY_KIND: Record<string, CreatableKind> = {
  "diary-seizures": "seizures",
  "diary-ketones": "ketones",
  "diary-weight": "weight",
  "diary-medications": "medications",
  "diary-side-effects": "side-effects",
};

/** Значение параметра → цель. Незнакомое значение — главная. */
export function targetOf(value: string | null | undefined): LaunchTarget {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "menu") return { tab: "today", view: "menu" };
  if (normalized === "diary") return { tab: "diary" };
  const kind = DIARY_KIND[normalized];
  if (kind !== undefined) return { tab: "diary", addKind: kind };
  if (normalized === "settings") return { settings: true };
  if (normalized === "family" || normalized === "reminders") {
    return { settings: true, section: normalized };
  }
  return { tab: "today" };
}

/**
 * Значение параметра запуска из адреса или `null`, если его нет.
 *
 * Источники по порядку:
 *
 * 1. `open` — в строке запроса (`?open=diary-ketones`) или в хеше рядом с
 *    `tgWebAppData` (`#tgWebAppData=…&open=…`). Так открывает кнопка бота с
 *    адресом приложения: Telegram дописывает подпись в хеш, а запрос оставляет.
 * 2. `tgWebAppStartParam` — в хеше или запросе: так Telegram передаёт
 *    `startapp` прямой ссылки `t.me/<бот>/<приложение>?startapp=…`.
 * 3. `start_param` — то же значение внутри строки запуска (`initData`).
 */
export function launchValue(
  location: { search: string; hash: string },
  initData: string | null,
  startParam?: string | null,
): string | null {
  const sources = [location.search.slice(1), location.hash.slice(1)].map(
    (source) => new URLSearchParams(source),
  );
  for (const name of ["open", "tgWebAppStartParam"]) {
    for (const params of sources) {
      const value = params.get(name);
      if (value !== null && value.trim() !== "") return value.trim();
    }
  }
  if (startParam != null && startParam.trim() !== "") return startParam.trim();
  if (initData !== null) {
    const value = new URLSearchParams(initData).get("start_param");
    if (value !== null && value.trim() !== "") return value.trim();
  }
  return null;
}

/** Цель запуска или `null`, если приложение открыли без параметра. */
export function launchTargetOf(
  location: { search: string; hash: string },
  initData: string | null,
  startParam?: string | null,
): LaunchTarget | null {
  const value = launchValue(location, initData, startParam);
  return value === null ? null : targetOf(value);
}

/** Цель запуска этой страницы — по адресу и строке запуска Telegram. */
export function readLaunchTarget(): LaunchTarget | null {
  if (typeof window === "undefined") return null;
  return launchTargetOf(
    window.location,
    launchData(),
    webApp()?.initDataUnsafe?.start_param ?? null,
  );
}
