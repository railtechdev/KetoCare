import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  /** Что здесь появится и как это заполнить */
  description?: ReactNode;
  /** Кнопка действия: пустое состояние без выхода — тупик */
  action?: ReactNode;
  className?: string;
}

/**
 * Пустое состояние экрана или списка.
 *
 * Три части обязательны по смыслу: что здесь будет, как это заполнить и чем.
 * Серый абзац «Записей пока нет» без объяснения и без действия оставляет
 * пользователя в тупике — а таких абзацев в приложении было большинство.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-6" />
        </span>
      )}
      <p className="m-0 font-semibold text-foreground">{title}</p>
      {description && (
        <p className="m-0 max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
