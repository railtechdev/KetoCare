import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { formatOccurredAt } from "../lib/format";
import { useKitLabels } from "../lib/kitLabels";

export interface DiaryEntryCardProps {
  title: string;
  /** Момент события (occurred_at), уже в часовом поясе пациента */
  occurredAt: Date;
  /** Канал ввода — раздел 4.2 ТЗ: web | bot | miniapp | ai_parsed */
  source?: "web" | "bot" | "miniapp" | "ai_parsed";
  /** Тип события (напр. «приём пищи», «кетоны», «глюкоза», «приступ», «вес») */
  category?: ReactNode;
  /** Главный числовой показатель записи (напр. «3,2 ммоль/л») */
  metric?: ReactNode;
  /** Семантический статус / подсветка отклонения */
  status?: "default" | "success" | "warning" | "destructive";
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

const STATUS_STYLES = {
  default: "border-border",
  success: "border-success/40 bg-success-subtle/30",
  warning: "border-warning/50 bg-warning-subtle/30",
  destructive: "border-destructive/50 bg-destructive-subtle/30",
} as const;

/** Карточка записи дневника (раздел 8.2 ТЗ). */
export function DiaryEntryCard({
  title,
  occurredAt,
  source,
  category,
  metric,
  status = "default",
  children,
  actions,
  className,
}: DiaryEntryCardProps) {
  const sourceLabels = useKitLabels().diarySource;
  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-4 text-foreground shadow-sm transition-colors",
        STATUS_STYLES[status],
        className,
      )}
      data-status={status}
    >
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="m-0 text-base font-semibold">{title}</h3>
          {category && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {category}
            </span>
          )}
        </div>
        <time
          className="text-sm whitespace-nowrap text-muted-foreground tabular-nums shrink-0"
          dateTime={occurredAt.toISOString()}
        >
          {formatOccurredAt(occurredAt)}
        </time>
      </header>

      {metric && (
        <div className="mt-2 text-metric font-semibold tabular-nums text-foreground">
          {metric}
        </div>
      )}

      {children && <div className="mt-2">{children}</div>}

      <footer className="mt-3 flex items-center justify-between gap-3">
        {source && (
          // Помечается только распознанное ИИ: пользователю важно знать, что запись
          // разобрана автоматически и её стоит перепроверить (раздел 10.3 ТЗ).
          <span
            className={cn(
              "text-xs text-muted-foreground",
              source === "ai_parsed" && "font-semibold text-warning-strong",
            )}
            data-source={source}
          >
            {sourceLabels[source]}
          </span>
        )}
        {/* Тач-цели действий не меньше 44 px (раздел 8.2 ТЗ) */}
        {actions && (
          <div className="ml-auto flex gap-2 [&_a]:min-h-touch [&_button]:min-h-touch">
            {actions}
          </div>
        )}
      </footer>
    </article>
  );
}
