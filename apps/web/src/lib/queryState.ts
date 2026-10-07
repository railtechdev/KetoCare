import i18n from "./i18n";

/** То, что `queryState` читает у запроса TanStack Query. */
export interface QueryLike {
  isPending: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
}

/**
 * Состояние «загрузка / ожидание связи» для `AsyncSection` — одно правило на
 * все блоки данных кабинета.
 *
 * Пишется так: `<AsyncSection {...queryState(logs)} … />` вместо
 * `loading={logs.isLoading}`. Почему не `isLoading`: он равен
 * `isPending && isFetching`, а без сети запрос не идёт, а стоит на паузе
 * (`fetchStatus: "paused"`). `isLoading` тогда ложен, данных нет — и блок
 * показывал пустое состояние: «записей нет», «ребёнка ещё нет», «назначений
 * нет». Семья без связи читала неправду о своих данных.
 *
 * - `loading` — данных ещё нет, и запрос либо идёт, либо ждёт связи. Запрос,
 *   выключенный через `enabled: false`, не загружается (`fetchStatus: "idle"`):
 *   иначе блок, ждущий выбора, крутил бы скелетон бесконечно;
 * - `waiting` — данных нет и запрос ждёт связи; `AsyncSection` говорит об этом
 *   словами, а не скелетоном (обещания загрузки, которой нет).
 *
 * Запросов может быть несколько — блок, собранный из нескольких ответов,
 * загружается, пока не пришёл хоть один из них.
 *
 * Функция, а не хук: её можно звать в любой ветке разметки. Удерживается
 * тестом `asyncSections.test.ts`.
 */
export function queryState(...queries: QueryLike[]): {
  loading: boolean;
  waiting: string | null;
} {
  const loading = queries.some(
    (query) => query.isPending && query.fetchStatus !== "idle",
  );
  const paused = queries.some(
    (query) => query.isPending && query.fetchStatus === "paused",
  );
  return {
    loading,
    waiting: paused ? i18n.t("common:errors.waitingForNetwork") : null,
  };
}

/**
 * Состояние запроса для экрана, который рисует себя сам, без `AsyncSection`.
 * Правило то же: «данных ещё нет» — это и загрузка, и ожидание связи, а не
 * пустота.
 */
export function isAwaitingData(query: QueryLike): boolean {
  return query.isPending && query.fetchStatus !== "idle";
}
