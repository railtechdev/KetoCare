/**
 * Отказ помощника — не ответ.
 *
 * Раздел 10.4 ТЗ требует подпись «не заменяет консультацию врача» под каждым
 * ОТВЕТОМ. Отказ ответом не является ни в одном из случаев: постфильтр
 * заменил текст шаблоном, материала в базе знаний не нашлось, исчерпан
 * суточный предел вопросов или помощник недоступен. Шаблоны сами ведут к
 * врачу, недоступность и предел говорят о службе, а под отказом стоит свой
 * следующий шаг (`refusalNextStep`) — подпись ответа там лишняя.
 *
 * Признаков два, потому что и путей два. Воркер помечает свои отказы `blocked`
 * (недоступность — ещё и `status: "failed"`), а ручка, у которой не встала
 * задача в очередь, пишет «помощник недоступен» ТОЛЬКО со `status: "failed"`,
 * без `blocked` (ADR-0035). Снимешь второе условие как избыточное — «Помощник
 * сейчас недоступен» станет выглядеть ответом, с подписью и без «Спросить ещё
 * раз». Статей (`sources`) отказ не несёт никогда, поэтому скрывается вся
 * подпись целиком.
 *
 * Правило живёт в ките, а не в экранах: кабинет и Mini App обязаны считать
 * отказом одно и то же. Толкование «отказ не ответ» записано в ADR-0022 —
 * экран его не толкует.
 */
export interface AssistantMessageSignals {
  /** `pending` | `done` | `failed` — состояние сообщения помощника */
  status: string;
  /** Ответ заменён шаблоном (постфильтр, пустая база, предел, недоступность) */
  blocked?: boolean;
  /** Отказ — исчерпанный предел или бюджет; приходит вместе с `blocked` */
  limited?: boolean;
}

export function isRefusal(message: AssistantMessageSignals): boolean {
  return message.blocked === true || message.status === "failed";
}

/**
 * What the screen offers under a refusal (Mini App audit 2026-11, П4).
 *
 * - `retry` — the assistant was unavailable: the same question can be asked
 *   again;
 * - `doctor` — the question was turned away (doctor template, no matching
 *   article): «ask the doctor at the visit» and the clinic phone;
 * - `none` — a spent limit or budget. Its text already says the assistant is
 *   back tomorrow, and «ask the doctor» would send an app question to someone
 *   who does not answer them.
 *
 * `null` — not a refusal, nothing to offer.
 */
export type RefusalNextStep = "retry" | "doctor" | "none";

export function refusalNextStep(
  message: AssistantMessageSignals,
): RefusalNextStep | null {
  if (!isRefusal(message)) return null;
  if (message.status === "failed") return "retry";
  if (message.limited === true) return "none";
  return "doctor";
}
