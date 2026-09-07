import { useCallback, useSyncExternalStore } from "react";

/**
 * Точки расхождения раскладки — те же, что у Tailwind.
 *
 * Объявлены здесь потому, что раскладка, которую нельзя выразить классом,
 * решается в JS: `SplitView` не может держать обе половины в разметке и прятать
 * одну классом `hidden` — скрытая половина осталась бы в дереве доступности и в
 * тестах, и «Назад» с телефона возвращал бы на экран, где список и карта
 * существуют одновременно.
 *
 * Значения совпадают с умолчаниями Tailwind (`md` 48rem, `lg` 64rem, `xl`
 * 80rem, `2xl` 96rem) и в rem, а не в px: при увеличенном шрифте страницы
 * раскладка обязана расходиться позже, иначе на «широком» экране колонки
 * оказываются уже, чем нужно тексту.
 */
export const BREAKPOINTS = {
  md: "48rem",
  lg: "64rem",
  xl: "80rem",
  "2xl": "96rem",
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/**
 * Достигнута ли ширина окна.
 *
 * Там, где `matchMedia` нет (среда тестов, разбор на сервере), ответ — «нет»:
 * узкая раскладка проста, работает всегда и ничего не прячет. Ошибиться в эту
 * сторону безопасно, в обратную — нет.
 */
export function useBreakpoint(breakpoint: Breakpoint): boolean {
  const query = `(min-width: ${BREAKPOINTS[breakpoint]})`;

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (
        typeof window === "undefined" ||
        typeof window.matchMedia !== "function"
      ) {
        return () => undefined;
      }
      const list = window.matchMedia(query);
      // До Safari 14 у `MediaQueryList` нет `addEventListener`. Подписки не
      // будет — раскладка не переставится при повороте экрана, — но исключение
      // внутри `subscribe` уронило бы весь рендер.
      if (typeof list.addEventListener !== "function") return () => undefined;
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  const snapshot = useCallback(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
    [query],
  );

  return useSyncExternalStore(subscribe, snapshot, () => false);
}
