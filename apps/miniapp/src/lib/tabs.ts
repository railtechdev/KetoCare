import { createContext } from "react";

import type { LaunchTarget } from "./launchTarget";
import { cloudStorage } from "./telegram";

/**
 * Вкладки нижней полосы — в её порядке (ADR-0075, вместо шести ADR-0044).
 *
 * Четыре, а не шесть: «Сводка» и «Меню» показывали один день на двух вкладках,
 * а «Рецепты» и «Расчёт» отвечают на один вопрос — что приготовить.
 */
export const TAB_IDS = ["today", "diary", "dishes", "assistant"] as const;

export type TabId = (typeof TAB_IDS)[number];

export function isTabId(value: unknown): value is TabId {
  return (TAB_IDS as readonly unknown[]).includes(value);
}

/**
 * Переход из экрана в другое место приложения.
 *
 * Роутера в Mini App нет (раздел 5.2 ТЗ): вкладку выбирает `Screens`, и экран,
 * которому нужно отправить человека в другое место («отметить еду — в меню»),
 * получает переход отсюда, а не пропом через три уровня. Вне `Screens` (в
 * тестах отдельного экрана) переход ничего не делает.
 */
export const NavigateContext = createContext<(target: LaunchTarget) => void>(
  () => undefined,
);

/**
 * Запрос к уже смонтированному экрану: открыть меню, форму записи.
 *
 * Номер растёт с каждым запросом: два одинаковых подряд («открыть кетоны»
 * дважды) обязаны сработать оба, а сравнение по содержимому пропустило бы
 * второй.
 */
export interface ScreenRequest<T> {
  id: number;
  target: T;
}

const TAB_KEY = "ketocare.miniapp.tab";

/**
 * Вкладка, открытая в прошлый раз, — с этого же устройства.
 *
 * Хранилище бывает недоступно (закрытый режим, запрет данных сайта) — тогда
 * открывается «Сегодня».
 */
export function rememberedTab(): TabId | null {
  try {
    const value = globalThis.localStorage?.getItem(TAB_KEY) ?? null;
    return isTabId(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Вкладка из облака Telegram (Bot API 6.9) — когда на этом устройстве её ещё
 * не запоминали: тот же человек на компьютере открывает то же, что на
 * телефоне. Ответ асинхронный; `onTab` не зовётся, если вкладки нет.
 */
export function rememberedCloudTab(onTab: (tab: TabId) => void): void {
  const storage = cloudStorage();
  if (storage === null) return;
  try {
    storage.getItem(TAB_KEY, (error, value) => {
      if (error === null && isTabId(value)) onTab(value);
    });
  } catch {
    // Облако — удобство: без него остаётся «Сегодня».
  }
}

/** Запомнить вкладку здесь и, если умеет клиент, в облаке Telegram. */
export function rememberTab(tab: TabId): void {
  try {
    globalThis.localStorage?.setItem(TAB_KEY, tab);
  } catch {
    // Не запомнили — в следующий раз откроется «Сегодня», не более.
  }
  try {
    cloudStorage()?.setItem(TAB_KEY, tab);
  } catch {
    // То же.
  }
}
