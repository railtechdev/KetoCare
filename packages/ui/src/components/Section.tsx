import type { ReactNode } from "react";

import { cn } from "@ui/lib/cn";
import { useDensity, type Density } from "@ui/lib/density";
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
   *
   * Не задано — плотность берётся у экрана (`PageLayout density`). Явное
   * значение сильнее: у отдельного блока бывает своя причина.
   */
  density?: Density;
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
  density,
  titleHidden = false,
  className,
  contentClassName,
  children,
}: SectionProps) {
  const compact = useDensity(density) === "compact";
  const Heading = level === 2 ? "h2" : "h3";

  return (
    <Card
      // `@container` — чтобы содержимое блока подстраивалось под ширину САМОГО
      // блока, а не окна. Один и тот же блок стоит и во всю колонку, и в
      // приставной колонке 20rem: `sm:grid-cols-2` внутри него спрашивает о
      // ширине окна и в узкой колонке на широком мониторе оставался
      // двухстолбцовым — подписи ломались, числа налезали друг на друга.
      // Внутри блоков вместо `sm:` пишется `@sm:` (правило П33 канона).
      className={cn(
        "@container",
        compact && "gap-block rounded-lg py-block",
        !compact && "gap-block",
        className,
      )}
    >
      <CardHeader className={cn(compact && "px-block")}>
        {/* `min-w-0 break-words`: шапка карточки — сетка (`1fr auto` при
            действии), и без `min-w-0` заголовок с именем без пробелов не
            сжимался, а распирал блок. */}
        <CardTitle
          className={cn(
            "min-w-0 break-words",
            level === 2 ? "text-section-title" : "text-card-title",
            titleHidden && "sr-only",
          )}
        >
          <Heading className="m-0 font-semibold">{title}</Heading>
        </CardTitle>
        {description && (
          <CardDescription
            className={cn("min-w-0 break-words", titleHidden && "sr-only")}
          >
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
