import { useEffect, useState } from "react";

/**
 * Значение, обновляющееся не чаще чем раз в `delayMs`.
 *
 * Нужно поисковым полям (`SEARCH_DELAY_MS`) и живому расчёту
 * (`RECALC_DELAY_MS`): без задержки каждый набранный символ уходил бы запросом.
 * Живёт в ките, а не в каждом приложении: копии в кабинете и Mini App
 * совпадали до байта и однажды разошлись бы.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
