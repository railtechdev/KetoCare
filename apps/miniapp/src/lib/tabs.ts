import { createContext } from "react";

/** Вкладки нижней полосы — в её порядке (раздел 9 ТЗ, ADR-0044). */
export type TabId =
  "home" | "menu" | "calculator" | "recipes" | "diary" | "assistant";

/**
 * Переход на другую вкладку из экрана.
 *
 * Роутера в Mini App нет (раздел 5.2 ТЗ): вкладку выбирает `Screens`, и экран,
 * которому нужно отправить человека в другое место («отметить еду — в плане
 * дня»), получает переход отсюда, а не пропом через три уровня. Вне `Screens`
 * (в тестах отдельного экрана) переход ничего не делает.
 */
export const OpenTabContext = createContext<(tab: TabId) => void>(
  () => undefined,
);
