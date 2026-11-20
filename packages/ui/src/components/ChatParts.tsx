import type { ReactNode } from "react";

import { cn } from "@ui/lib/cn";
import { Button } from "./ui/button";

/**
 * A day over the messages said on it: «Сегодня», «Вчера», «13 ноября»
 * (Mini App audit 2026-11, П8). The text comes from `withChatDays`.
 */
export function ChatDayDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-full bg-muted px-3 py-0.5 text-xs text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

export interface ChatSourceArticle {
  slug: string;
  title: string;
}

export interface ChatSourcesProps {
  /** «Источник:» — from the app's dictionary. */
  label: string;
  articles: readonly ChatSourceArticle[];
  onOpen: (article: ChatSourceArticle) => void;
}

/**
 * The articles an answer rests on — titles that open the article (П7, П9).
 *
 * A source written as plain text was a promise without a page: the family saw
 * «Источник: Как записать кетоны» and could not read it. Buttons, not links:
 * the article opens in a panel over the conversation, not at an address.
 */
export function ChatSources({ label, articles, onOpen }: ChatSourcesProps) {
  if (articles.length === 0) return null;
  return (
    <p className="m-0">
      <span className="text-muted-foreground">{label}</span>{" "}
      {articles.map((article, index) => (
        <span key={article.slug}>
          {index > 0 && ", "}
          <button
            type="button"
            className="py-1 text-left text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => onOpen(article)}
          >
            {article.title}
          </button>
        </span>
      ))}
    </p>
  );
}

export interface ChatStarter {
  key: string;
  label: string;
}

export interface ChatStartersProps {
  /** «Например, спросите:» — from the app's dictionary. */
  title: string;
  items: readonly ChatStarter[];
  onPick: (key: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Ready questions on the empty conversation (П7, decision Р5).
 *
 * A paragraph «спросите о приложении» did not tell the family what can be
 * asked; a button both tells and asks. A tap sends the question at once — the
 * screen decides what text goes out (in Uzbek the label is Uzbek and the
 * question Russian: the knowledge base is Russian).
 */
export function ChatStarters({
  title,
  items,
  onPick,
  disabled = false,
  className,
}: ChatStartersProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="m-0 text-sm text-muted-foreground">{title}</p>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {items.map((item) => (
          <li key={item.key} className="max-w-full">
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="h-auto min-h-touch max-w-full whitespace-normal text-left"
              onClick={() => onPick(item.key)}
            >
              {item.label}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
