import type { ReactNode } from "react";

import { KitLabelsContext, type KitLabels } from "../lib/kitLabels";

/** Подписи предметных компонентов кита — из словаря приложения (ADR-0052). */
export function KitLabelsProvider({
  labels,
  children,
}: {
  labels: KitLabels;
  children: ReactNode;
}) {
  return <KitLabelsContext value={labels}>{children}</KitLabelsContext>;
}
