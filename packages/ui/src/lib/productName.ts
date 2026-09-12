/**
 * Что известно об имени продукта в составе.
 *
 * Различать обязательно: «удалён из справочника» — утверждение о справочнике, а
 * «название не загрузилось» — о связи. По карточке готовят, и неверно названный
 * продукт рядом с граммовкой хуже пустоты.
 *
 * Правило живёт в ките, а не в каждом приложении: кабинет и Mini App показывают
 * один и тот же рецепт, и различать эти случаи они обязаны одинаково. Тексты
 * при этом у каждого свои — это i18n, а не логика.
 */
export type ProductName =
  | { kind: "name"; name: string }
  | { kind: "missing" }
  | { kind: "unavailable" }
  | { kind: "pending" };

export interface ProductNameInput {
  /**
   * Имя из карточки продукта.
   *
   * `null` — справочник ответил «такого продукта нет» (404): это ОТВЕТ, а не
   * сбой. `undefined` — ответа ещё нет.
   */
  name?: string | null;
  /** Запрос завершился отказом */
  isError: boolean;
  /** Запрос стоит на паузе: сети нет, и он даже не уходил */
  isPaused: boolean;
}

/**
 * Состояние имени по одному запросу карточки.
 *
 * Признак построчный, а не общий на состав: общий переносил бы «название не
 * загрузилось» на строки, где имя уже пришло. Флаг `isLoading` здесь не
 * годится вовсе — он равен `isPending && isFetching`, а на паузе запрос не
 * идёт, и `isLoading` ложен при том, что имени нет.
 */
export function productNameState({
  name,
  isError,
  isPaused,
}: ProductNameInput): ProductName {
  if (name !== undefined) {
    return name === null ? { kind: "missing" } : { kind: "name", name };
  }
  return isError || isPaused ? { kind: "unavailable" } : { kind: "pending" };
}
