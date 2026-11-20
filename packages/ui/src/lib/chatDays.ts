import { formatLocale } from "./format";

/** Words for the two nearest days, from the app's dictionary. */
export interface ChatDayWords {
  today: string;
  yesterday: string;
}

const DAY_MS = 86_400_000;

function startOfDay(value: Date): number {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
}

/**
 * The label over the first message of a day: «Сегодня», «Вчера», «13 ноября».
 *
 * The family's conversation is one endless thread (Mini App audit 2026-11,
 * П8): without days a month-old answer stood as if given today. Days are local
 * — the family's midnight, not UTC. The month is written in the screen's
 * language (`formatLocale`), the year only when it is not this year.
 */
export function chatDayLabel(at: Date, now: Date, words: ChatDayWords): string {
  // Rounded: a day across a daylight-saving switch is 23 or 25 hours long.
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days === 0) return words.today;
  if (days === 1) return words.yesterday;
  return new Intl.DateTimeFormat(formatLocale(), {
    day: "numeric",
    month: "long",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(at);
}

/**
 * Each item with the day label to put above it, or `null` when it continues
 * the previous item's day. One rule for the cabinet and the Mini App.
 */
export function withChatDays<T>(
  items: readonly T[],
  at: (item: T) => Date,
  now: Date,
  words: ChatDayWords,
): { item: T; day: string | null }[] {
  let previous: number | null = null;
  return items.map((item) => {
    const date = at(item);
    const day = startOfDay(date);
    const label =
      previous === null || day !== previous
        ? chatDayLabel(date, now, words)
        : null;
    previous = day;
    return { item, day: label };
  });
}
