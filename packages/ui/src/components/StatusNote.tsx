import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * Строка о состоянии дел, которую скринридер объявляет сам.
 *
 * `role="status"` — вежливая живая область: она не перебивает человека, как
 * `alert`, но и не молчит. Живёт в ките, потому что такие строки уже две —
 * ожидание связи в `AsyncSection` и оно же на экране динамики, — и написанные
 * порознь они разойдутся видом и ролью. Строки ожидания в калькуляторе Mini App
 * сюда не сведены: у них свой `id`, на который ссылается `aria-describedby`
 * поля, и свой размер.
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
