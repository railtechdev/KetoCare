import { useEffect, useState } from "react";

/**
 * Значение, обновляющееся не чаще чем раз в `delayMs`.
 *
 * Нужно поисковым полям: без задержки каждый набранный символ уходил бы в
 * полнотекстовый запрос к базе.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
