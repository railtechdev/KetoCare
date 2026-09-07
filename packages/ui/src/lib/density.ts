import { createContext, useContext } from "react";

/**
 * Плотность экрана: `comfortable` — семья, `compact` — специалист.
 *
 * Правило П26 канона требует, чтобы экраны врача и администратора были плотнее
 * родительских, но механизма для этого не было ни одного: плотность выбирал
 * автор каждого блока по отдельности, проставляя `density="compact"` руками. Из
 * тридцати служебных блоков его проставили в трёх — правило существовало только
 * в тексте канона. Здесь плотность объявляется один раз на экран (`PageLayout
 * density`), а блоки её наследуют.
 *
 * Контекст и хук лежат отдельно от компонента-поставщика: файл, экспортирующий
 * и компонент, и функцию, ломает горячую замену модулей в dev-сборке.
 */
export type Density = "comfortable" | "compact";

export const DensityContext = createContext<Density>("comfortable");

/** Плотность экрана; `override` — явный выбор блока, он сильнее. */
export function useDensity(override?: Density): Density {
  const inherited = useContext(DensityContext);
  return override ?? inherited;
}
