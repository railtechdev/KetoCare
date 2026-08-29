import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
} from "@ketocare/ui";
import type { ReactNode } from "react";

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
    <Card className={cn("gap-block", className)}>
      <CardHeader>
        <CardTitle className="text-card-title">{title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
