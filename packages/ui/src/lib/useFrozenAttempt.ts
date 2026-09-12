import { useRef } from "react";

import { useAttemptKey } from "./useAttemptKey";

export interface FrozenAttempt<T> {
  /** Что уйдёт на сервер: до отправки свежее, после — то же, что в первой. */
  value: T;
  /** Ключ повторной отправки для этой попытки (ADR-0035). */
  key: string;
  /** Вызывается перед отправкой: с этого мгновения попытка заморожена. */
  freeze: () => void;
}

/**
 * Попытка записи, часть которой клиенту ещё неизвестна.
 *
 * Ключ повторной отправки обязан покрывать всё тело запроса, но часть тела
 * может прийти позже самого намерения: у помощника это открытый разговор —
 * список переписок читается отдельным запросом. Если слать его как есть,
 * повтор после потерянного ответа уйдёт с другим телом, другим ключом и
 * заведёт вторую запись; если заморозить слишком рано — уйдёт с пустым
 * значением при живом разговоре и разорвёт переписку (ADR-0022, ADR-0035).
 *
 * Поэтому до отправки берётся свежайшее значение, а с первой отправки —
 * замороженное. Смена `signature` (того, что человек записывает) — это уже
 * другая запись: попытка начинается заново.
 */
export function useFrozenAttempt<T>(
  signature: string,
  current: T,
): FrozenAttempt<T> {
  const attempt = useRef<{ signature: string; value: T; sent: boolean } | null>(
    null,
  );

  if (attempt.current === null || attempt.current.signature !== signature) {
    attempt.current = { signature, value: current, sent: false };
  } else if (!attempt.current.sent) {
    attempt.current.value = current;
  }

  const value = attempt.current.value;
  const key = useAttemptKey(JSON.stringify([signature, value]));

  return {
    value,
    key,
    freeze: () => {
      // Замораживаем по значению, а не флагом: в ссылке остаётся ровно то, что
      // ушло, даже если рендер, из которого вызвана отправка, был последним.
      attempt.current = { signature, value, sent: true };
    },
  };
}
