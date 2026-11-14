import { formatNumber } from "@ketocare/ui";

/**
 * Сокращённый идентификатор для таблиц: полный UUID занимает половину строки и
 * вытесняет то, ради чего таблица открыта. Полное значение остаётся в `title`.
 */
export function shortId(value: string): string {
  return value.length <= 8 ? value : `${value.slice(0, 8)}…`;
}

/**
 * Сумма в долларах: расход и бюджеты ИИ (ADR-0080). Центы всегда — рядом стоят
 * «потрачено» и «бюджет», и «3» рядом с «2,75» читалось бы как разнобой.
 * Сервер отдаёт деньги строкой (Decimal), отсюда приём строки.
 */
export function formatUsd(value: string | number): string {
  return "$" + formatNumber(Number(value), 2);
}
