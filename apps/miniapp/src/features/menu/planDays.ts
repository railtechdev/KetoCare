import {
  daysWithMenu,
  formatLongDate,
  formatWeekdayDay,
  parseDateInput,
  type ShoppingDay,
} from "@ketocare/ui";
import type { TFunction } from "i18next";

import { dayAt } from "./useMenu";

/**
 * Дни, с которыми работает приложение (Р3 аудита Mini App 21.11.2026).
 *
 * Было три — вчера, сегодня, завтра. Диетолог составляет неделю, а семья без
 * кабинета не видела послезавтра и не могла посмотреть, что купить. Теперь
 * правило одно на все экраны:
 *
 * - **меню** — вчера, сегодня и пять дней вперёд (`MENU_DAYS`). Вчера — чтобы
 *   отметить съеденное задним числом;
 * - **поставить блюдо в меню и «Что купить»** — сегодня и пять дней вперёд
 *   (`PLAN_DAYS`): вчерашний день не собирают и к нему не покупают.
 *
 * Хранится СДВИГ от сегодня, а не дата: приложение, открытое в 23:58, после
 * полуночи иначе показывало бы вчерашнее меню, не подсветив ни одного дня.
 */
export const MENU_DAYS = [-1, 0, 1, 2, 3, 4, 5] as const;

/** Сегодня и пять дней вперёд — куда ставят блюдо и на что покупают. */
export const PLAN_DAYS = [0, 1, 2, 3, 4, 5] as const;

/** С какого дня запрашивается неделя: первый день полосы меню. */
export const WEEK_START_OFFSET = MENU_DAYS[0];

/** Последний день полосы — по него собирают и покупают. */
export const LAST_PLAN_OFFSET = PLAN_DAYS[PLAN_DAYS.length - 1] ?? 0;

/** Сдвиг из адреса или запроса — в пределах полосы меню, иначе «сегодня». */
export function clampMenuDay(offset: number | undefined): number {
  return offset !== undefined &&
    Number.isInteger(offset) &&
    (MENU_DAYS as readonly number[]).includes(offset)
    ? offset
    : 0;
}

/** Ключ словаря у трёх ближних дней — они называются словом. */
const NEAR_DAY: Record<number, string> = {
  [-1]: "menu.yesterday",
  0: "menu.today",
  1: "menu.tomorrow",
};

function dateOf(offset: number, now?: Date): Date | null {
  return parseDateInput(dayAt(offset, now));
}

/**
 * Подпись дня на полосе: «Вчера», «Сегодня», «Завтра», дальше — «пн 24».
 * На кнопку шириной в палец помещается одно слово и число.
 */
export function dayStripLabel(
  offset: number,
  t: TFunction,
  now?: Date,
): string {
  const near = NEAR_DAY[offset];
  if (near !== undefined) return t(near);
  const date = dateOf(offset, now);
  return date === null ? dayAt(offset, now) : formatWeekdayDay(date);
}

/**
 * Название дня в предложении: «Добавить в меню: Завтра», «…: среда, 26 ноября».
 * «пн 24» в предложении читалось бы как опечатка.
 */
export function dayName(offset: number, t: TFunction, now?: Date): string {
  const near = NEAR_DAY[offset];
  if (near !== undefined) return t(near);
  const date = dateOf(offset, now);
  return date === null
    ? dayAt(offset, now)
    : formatLongDate(date, { weekday: true });
}

/**
 * Подпись «Как вчера» с точки зрения выбранного дня. У трёх ближних — прежние
 * слова; дальше «Как в предыдущий день»: «как послепослезавтра» не говорят.
 */
export function copyLabelKey(offset: number): string {
  switch (offset) {
    case -1:
      return "menu.copy.asDayBeforeYesterday";
    case 0:
      return "menu.copy.asYesterday";
    case 1:
      return "menu.copy.asToday";
    default:
      return "menu.copy.asPreviousDay";
  }
}

/** Даты недели, в которые меню составлено, — для точек полосы дней. */
export function menuDatesOf(
  days: readonly ShoppingDay[] | null | undefined,
): Set<string> {
  return new Set(daysWithMenu(days).map((day) => day.date));
}
