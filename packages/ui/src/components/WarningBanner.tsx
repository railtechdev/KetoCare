import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";

export type WarningLevel = "info" | "warning" | "danger";

export interface WarningBannerProps {
  /**
   * Идентификатор баннера. Нужен, когда предупреждение относится к конкретному
   * содержимому и связывается с ним через `aria-describedby`: пометка
   * «черновик ИИ» обязана читаться вместе с текстом, а не отдельно от него.
   */
  id?: string;
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
 * Цветная полоса слева — признак уровня. После перехода на словарь кита
 * `danger` и `accent` перестали существовать как цвета, и самое тревожное
 * сообщение осталось вообще без полосы: неразрешимый расчёт выглядел спокойнее
 * обычного предупреждения.
 */
const BORDER_BY_LEVEL: Record<WarningLevel, string> = {
  info: "border-l-primary",
  warning: "border-l-warning",
  danger: "border-l-destructive",
};

/**
 * Значок уровня. Цвет — **не единственный** носитель смысла (WCAG 1.4.1): до
 * значков уровень различался только цветом полосы слева, и при дальтонизме или
 * чёрно-белой печати выписки предупреждение было неотличимо от опасности.
 * Соседний `PatientFlagsView` это правило соблюдал, баннер — нет.
 */
const ICON_BY_LEVEL: Record<WarningLevel, typeof Info> = {
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
};

const ICON_COLOR_BY_LEVEL: Record<WarningLevel, string> = {
  info: "text-primary",
  warning: "text-warning",
  danger: "text-destructive",
};

/**
 * Баннер предупреждения (раздел 8.3 ТЗ: выход за допуски в меню).
 *
 * Стоит на китовом `Alert`: у того сетка «значок + заголовок + текст», отступы
 * и типографика общие со всем остальным. Своими у баннера остаются ровно две
 * вещи, которых у `Alert` нет и которые несут продуктовое правило: три уровня и
 * роль для скринридера, зависящая от уровня. `Alert` жёстко ставит
 * `role="alert"` — он переопределяется, потому что спред пропов идёт после.
 */
export function WarningBanner({
  id,
  level = "warning",
  title,
  children,
  className,
}: WarningBannerProps) {
  const Icon = ICON_BY_LEVEL[level];

  return (
    <Alert
      id={id}
      role={ROLE_BY_LEVEL[level]}
      data-level={level}
      className={cn(
        "border-l-4 shadow-kc-sm",
        BORDER_BY_LEVEL[level],
        className,
      )}
    >
      <Icon aria-hidden="true" className={ICON_COLOR_BY_LEVEL[level]} />
      {/* `line-clamp-none` снимает обрезку заголовка одной строкой: у кита
          заголовок короткий, а у нас это фраза вроде «Кетосоотношение дня
          выходит за допуски назначения» — в приставной колонке она занимает
          три строки, и обрезка съела бы смысл. */}
      {title && (
        <AlertTitle className="line-clamp-none font-semibold">
          {title}
        </AlertTitle>
      )}
      <AlertDescription className="text-foreground">
        {children}
      </AlertDescription>
    </Alert>
  );
}
