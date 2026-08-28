/**
 * Сокращённый идентификатор для таблиц: полный UUID занимает половину строки и
 * вытесняет то, ради чего таблица открыта. Полное значение остаётся в `title`.
 */
export function shortId(value: string): string {
  return value.length <= 8 ? value : `${value.slice(0, 8)}…`;
}
