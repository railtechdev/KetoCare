import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export interface FilterBarProps {
  /**
   * Подпись набора для скринридера: «Отбор продуктов». Видимого заголовка у
   * панели отбора нет — поля называют себя сами, а надпись «Фильтры» над двумя
   * подписанными полями была бы шумом.
   */
  label: string;
  /** Действие справа: сброс отбора. Прижимается к концу строки. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Поля отбора одной строкой с переносом.
 *
 * До неё поля отбора шли обычными полями формы — каждое своей строкой во всю
 * колонку. На справочнике продуктов два элемента отбора, поиск и категория,
 * занимали две строки по 86 px и отодвигали таблицу на 172 px вниз, при том что
 * справа от них было свободно около 900 px. Отбор — не форма: его поля читают
 * не сверху вниз, а как одну панель, и переносятся они по мере надобности.
 *
 * `items-end` — чтобы поля с подписью и без неё стояли на одной линии по низу
 * (кнопка сброса рядом с полем поиска, а не под ним).
 */
export function FilterBar({
  label,
  action,
  className,
  children,
}: FilterBarProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-end gap-block", className)}
    >
      {children}
      {action && <div className="ms-auto flex items-end">{action}</div>}
    </div>
  );
}
