import type { ReactNode } from "react";

import { cn } from "@ui/lib/cn";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";

export interface SectionProps {
  /** Заголовок блока. Пустым не бывает: блок без имени неотличим от отступа. */
  title: string;
  /**
   * Уровень заголовка: 2 — блок экрана, 3 — блок внутри блока.
   * Уровни не пропускаются, `h1` ставит `PageLayout` (правило П24 канона).
   */
  level?: 2 | 3;
  /** Пояснение под заголовком */
  description?: ReactNode;
  /** Действие блока — в правом верхнем углу */
  action?: ReactNode;
  /**
   * `compact` — служебные экраны (врач, администратор) и плотные списки.
   * Родительские экраны идут с обычной плотностью (правило П26 канона).
   */
  density?: "comfortable" | "compact";
  /**
   * Заголовок только для скринридера. Для блоков, которые узнаются по
   * содержимому и подпись над которыми была бы шумом (панель фильтров).
   */
  titleHidden?: boolean;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

/**
 * Блок внутри экрана — единственный способ его выделить.
 *
 * Существует потому, что до него блок заворачивали кто во что: `<Card>` в 27
 * файлах экранов, `<fieldset>` в 7, остальные — ни во что. Заголовок блока
 * писался пятью способами (`CardTitle`, `CardTitle` с `aria-level`, `h2`
 * внутри `CardTitle`, `legend`, просто абзац нужного размера), и из 72 файлов
 * только 6 выдавали в разметку хоть один `h2` — навигация по заголовкам для
 * скринридера не работала (`docs/AUDIT_UI_LAYOUT.md`).
 *
 * `fieldset` остаётся там, где он обязателен семантически: группа радиокнопок
 * или флажков с общей подписью. Всё остальное — этот компонент.
 */
export function Section({
  title,
  level = 2,
  description,
  action,
  density = "comfortable",
  titleHidden = false,
  className,
  contentClassName,
  children,
}: SectionProps) {
  const compact = density === "compact";
  const Heading = level === 2 ? "h2" : "h3";

  return (
    <Card
      className={cn(
        compact && "gap-block rounded-lg py-block",
        !compact && "gap-block",
        className,
      )}
    >
      <CardHeader className={cn(compact && "px-block")}>
        <CardTitle
          className={cn(
            level === 2 ? "text-section-title" : "text-card-title",
            titleHidden && "sr-only",
          )}
        >
          <Heading className="m-0 font-semibold">{title}</Heading>
        </CardTitle>
        {description && (
          <CardDescription className={cn(titleHidden && "sr-only")}>
            {description}
          </CardDescription>
        )}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>

      <CardContent
        className={cn(
          "flex flex-col gap-block",
          compact && "px-block",
          contentClassName,
        )}
      >
        {children}
      </CardContent>
    </Card>
  );
}
