import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { formatOccurredAt } from "../lib/format";

export interface DiaryEntryCardProps {
  title: string;
  /** Момент события (occurred_at), уже в часовом поясе пациента */
  occurredAt: Date;
  /** Канал ввода — раздел 4.2 ТЗ: web | bot | miniapp | ai_parsed */
  source?: "web" | "bot" | "miniapp" | "ai_parsed";
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

const SOURCE_LABEL: Record<
  NonNullable<DiaryEntryCardProps["source"]>,
  string
> = {
  web: "Веб",
  bot: "Бот",
  miniapp: "Приложение",
  ai_parsed: "Распознано ИИ",
};

/** Карточка записи дневника (раздел 8.2 ТЗ). */
export function DiaryEntryCard({
  title,
  occurredAt,
  source,
  children,
  actions,
  className,
}: DiaryEntryCardProps) {
  return (
    <article
      className={cn(
        "rounded-xl bg-card p-4 text-foreground shadow-kc",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">{title}</h3>
        <time
          className="text-sm whitespace-nowrap text-muted-foreground tabular-nums"
          dateTime={occurredAt.toISOString()}
        >
          {formatOccurredAt(occurredAt)}
        </time>
      </header>

      {children && <div className="mt-2">{children}</div>}

      <footer className="mt-3 flex items-center justify-between gap-3">
        {source && (
          // Помечается только распознанное ИИ: пользователю важно знать, что запись
          // разобрана автоматически и её стоит перепроверить (раздел 10.3 ТЗ).
          <span
            className={cn(
              "text-xs text-muted-foreground",
              source === "ai_parsed" && "font-semibold text-warning",
            )}
            data-source={source}
          >
            {SOURCE_LABEL[source]}
          </span>
        )}
        {/* Тач-цели действий не меньше 44 px (раздел 8.2 ТЗ) */}
        {actions && (
          <div className="flex gap-2 [&_a]:min-h-touch [&_button]:min-h-touch">
            {actions}
          </div>
        )}
      </footer>
    </article>
  );
}
