import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export type WarningLevel = "info" | "warning" | "danger";

export interface WarningBannerProps {
  level?: WarningLevel;
  title?: string;
  children: ReactNode;
  className?: string;
}

const ROLE_BY_LEVEL: Record<WarningLevel, "status" | "alert"> = {
  info: "status",
  warning: "status",
  // Опасность объявляется немедленно: это выход за пределы назначения,
  // а не фоновая подсказка.
  danger: "alert",
};

/**
 * Цветная полоса слева — единственный признак уровня, помимо роли для
 * скринридера. После перехода на словарь кита `danger` и `accent` перестали
 * существовать как цвета, и самое тревожное сообщение осталось вообще без
 * полосы: неразрешимый расчёт выглядел спокойнее обычного предупреждения.
 */
const BORDER_BY_LEVEL: Record<WarningLevel, string> = {
  info: "border-l-primary",
  warning: "border-l-warning",
  danger: "border-l-destructive",
};

/** Баннер предупреждения (раздел 8.3 ТЗ: выход за допуски в меню). */
export function WarningBanner({
  level = "warning",
  title,
  children,
  className,
}: WarningBannerProps) {
  return (
    <div
      className={cn(
        "rounded-xl border-l-4 bg-card px-4 py-3 text-foreground shadow-kc-sm",
        BORDER_BY_LEVEL[level],
        className,
      )}
      role={ROLE_BY_LEVEL[level]}
      data-level={level}
    >
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}
