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
        "kc-warning-banner",
        `kc-warning-banner--${level}`,
        className,
      )}
      role={ROLE_BY_LEVEL[level]}
      data-level={level}
    >
      {title && <p className="kc-warning-banner__title">{title}</p>}
      <div className="kc-warning-banner__body">{children}</div>
    </div>
  );
}
