import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * Строка о состоянии дел, которую скринридер объявляет сам.
 *
 * `role="status"` — вежливая живая область: она не перебивает человека, как
 * `alert`, но и не молчит. Живёт в ките, потому что таких строк уже три —
 * ожидание связи в `AsyncSection`, оно же на экране динамики и в калькуляторе
 * Mini App, — и написанные порознь они разойдутся видом и ролью.
 */
export function StatusNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p role="status" className={cn("text-muted-foreground", className)}>
      {children}
    </p>
  );
}
