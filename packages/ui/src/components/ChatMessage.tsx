import type { ReactNode } from "react";

import { cn } from "@ui/lib/cn";
import { Skeleton } from "./ui/skeleton";

export interface ChatMessageProps {
  role: "user" | "assistant";
  children?: ReactNode;
  /** Ответ ещё не пришёл: на его месте ожидание, а не пустота */
  pending?: boolean;
  /** Строка под ответом: дисклеймер, список статей. Только у помощника */
  note?: ReactNode;
  className?: string;
}

/**
 * Сообщение переписки.
 *
 * Своя, а не общая карточка: у сообщения нет заголовка, действий и рамки — это
 * реплика, и всё оформление сводится к тому, чья она и ждём ли мы её.
 *
 * `note` живёт здесь, а не в экране, по одной причине: дисклеймер обязан стоять
 * под КАЖДЫМ ответом помощника (раздел 10.4 ТЗ), а собранный на экране он
 * однажды окажется не под всеми.
 */
export function ChatMessage({
  role,
  children,
  pending = false,
  note,
  className,
}: ChatMessageProps) {
  const own = role === "user";

  return (
    <div
      className={cn("flex", own ? "justify-end" : "justify-start", className)}
    >
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1 rounded-lg px-3 py-2",
          own
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {pending ? (
          <span aria-busy="true" className="flex flex-col gap-1 py-1">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-24" />
          </span>
        ) : (
          <span className="whitespace-pre-wrap break-words">{children}</span>
        )}

        {!own && note !== undefined && !pending && (
          <span className="text-xs opacity-80">{note}</span>
        )}
      </div>
    </div>
  );
}
