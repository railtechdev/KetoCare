import type { ReactNode } from "react";

import { cn } from "../lib/cn";

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

export function formatOccurredAt(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

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
    <article className={cn("kc-diary-card", className)}>
      <header className="kc-diary-card__header">
        <h3 className="kc-diary-card__title">{title}</h3>
        <time
          className="kc-diary-card__time"
          dateTime={occurredAt.toISOString()}
        >
          {formatOccurredAt(occurredAt)}
        </time>
      </header>

      {children && <div className="kc-diary-card__body">{children}</div>}

      <footer className="kc-diary-card__footer">
        {source && (
          // Помечается только распознанное ИИ: пользователю важно знать, что запись
          // разобрана автоматически и её стоит перепроверить (раздел 10.3 ТЗ).
          <span
            className={cn(
              "kc-diary-card__source",
              source === "ai_parsed" && "kc-diary-card__source--ai",
            )}
          >
            {SOURCE_LABEL[source]}
          </span>
        )}
        {actions && <div className="kc-diary-card__actions">{actions}</div>}
      </footer>
    </article>
  );
}
