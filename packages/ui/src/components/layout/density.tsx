import type { ReactNode } from "react";

import { DensityContext, type Density } from "../../lib/density";

/**
 * Объявляет плотность для всех блоков внутри. Ставится один раз на экран —
 * `PageLayout density`; см. `lib/density.ts`, там же записано, почему.
 */
export function DensityProvider({
  density,
  children,
}: {
  density: Density;
  children: ReactNode;
}) {
  return (
    <DensityContext.Provider value={density}>
      {children}
    </DensityContext.Provider>
  );
}
