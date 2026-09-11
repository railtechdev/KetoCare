import { useRef } from "react";

/**
 * Случайный ключ.
 *
 * `crypto.randomUUID` есть только в защищённом контексте и только с Safari
 * 15.4: по http в локальной сети и в старых WebView его нет, а вызов в теле
 * компонента уронил бы не сохранение, а весь экран — своего рубежа ошибок в
 * кабинете нет. `getRandomValues` есть везде, и сервер принимает любые видимые
 * символы ASCII до 255 (ADR-0035): UUID там рекомендован, а не обязателен.
 */
function randomKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Ключ попытки записи для заголовка `Idempotency-Key` (ADR-0035).
 *
 * Ключ один на попытку, а не на запрос: если ответ потерялся и человек нажал
 * снова, сервер по тому же ключу отдаёт прежний ответ, а не создаёт вторую
 * запись. Поэтому ключ живёт, пока не изменилось записываемое: `signature` —
 * это то, что уходит на сервер. Правка состава даёт новый ключ, иначе сервер
 * отказал бы 422 («тот же ключ, другой запрос»), а это уже не повтор.
 *
 * Держится на `useRef`, а не на `useMemo`: тот объявлен оптимизацией и вправе
 * забыть значение, а забытый ключ — это молча появившееся второе блюдо, ровно
 * то, от чего ключ и заводится.
 */
export function useAttemptKey(signature: string): string {
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  if (attempt.current === null || attempt.current.signature !== signature) {
    attempt.current = { signature, key: randomKey() };
  }

  return attempt.current.key;
}
