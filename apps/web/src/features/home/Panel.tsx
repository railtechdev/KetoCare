import { Card, CardContent, CardHeader, CardTitle } from "@ketocare/ui";
import type { ReactNode } from "react";

import { cn } from "@ketocare/ui";

/**
 * Блок сводки — тонкая обёртка над `Card` кита.
 *
 * Своей разметки здесь нет намеренно: единственное, что она добавляет, — общий
 * для всех блоков заголовок и отступ, чтобы блоки главной читались одним рядом.
 * Оформление берётся у кита и обновляется вместе с ним.
 */
export function Panel({
  title,
  action,
  className,
  children,
}: {
  title: string;
  /** Ссылка или кнопка в правом верхнем углу блока */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
