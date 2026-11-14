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

/**
 * Цена модели за миллион: «$2,50 / $10,00», а ноль — словом. «$0,00 / $0,00»
 * у своей установки читалось как незаполненная цена.
 */
export function formatModelPrice(
  priceIn: string,
  priceOut: string,
  free: string,
): string {
  return Number(priceIn) === 0 && Number(priceOut) === 0
    ? free
    : `${formatUsd(priceIn)} / ${formatUsd(priceOut)}`;
}

/** Целое число с разделителем разрядов: обращения, токены, люди. */
export function formatCount(value: number): string {
  return formatNumber(value, 0);
}
