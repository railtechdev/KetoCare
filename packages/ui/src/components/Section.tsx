import type { ReactNode } from "react";

import { cn } from "@ui/lib/cn";
import { useDensity, type Density } from "@ui/lib/density";
import {
  Card,
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
  /**
   * Действие блока — в правом верхнем углу.
   *
   * Не переносится: кнопка кита держит строку (`whitespace-nowrap`), и место
   * уступает заголовок. Переносимый текст здесь (голая ссылка) отнял бы место у
   * заголовка первым, и тот рвался бы там, где сейчас помещается. В узком
   * блоке (уже 28rem) действие встаёт под заголовок, а не рядом.
   */
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
  /**
   * Визуальный тон блока:
   * - `default` — основная рабочая карточка (`bg-card`)
   * - `accent` — фокусный блок первостепенной важности
   * - `muted` — справочный / второстепенный блок (`bg-muted/40`)
   */
  tone?: "default" | "accent" | "muted";
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
  tone = "default",
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
      // двухстолбцовым — подписи ломаются, числа налезают друг на друга.
      // Внутри блоков вместо `sm:` пишется `@sm:` (правило П33 канона).
      className={cn(
        "@container",
        compact && "gap-section rounded-lg py-section",
        !compact && "gap-section",
        tone === "accent" &&
          "border-primary/30 bg-linear-to-b from-secondary/50 to-card",
        tone === "muted" && "border-border/70 bg-muted/40 shadow-none",
        className,
      )}
    >
      {/* Шапка переносится по месту, а не по порогу ширины. Заголовок держит
          не меньше 16rem, действия — сколько им нужно; не помещаются рядом —
          уходят под заголовок. Прежде перенос включался запросом «блок уже
          28rem», а ширина действий в него не входила: две кнопки в блоке 35rem
          оставляли заголовку 60 px, и «Кто ведёт ребёнка дома» стояло по слогу
          в строке (снимок заказчика 13.11.2026). Кит (`card.tsx`) не правится —
          раскладка задаётся отсюда классами. */}
      <CardHeader
        className={cn(
          "flex flex-wrap items-start gap-x-section gap-y-2",
          compact && "px-section",
          titleHidden && !description && !action && "sr-only",
        )}
      >
        {/* `min-w-0 break-words`: имя без пробелов не распирает блок. Переноса
            по слогам нет: при основе 16rem колонка заголовка не бывает уже
            обычного слова, а Chromium с `hyphens-auto` рвал слова и там, где
            место было. */}
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1.5">
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
        </div>
        {action && (
          <div
            data-slot="section-action"
            className="flex flex-wrap items-center gap-2"
          >
            {action}
          </div>
        )}
      </CardHeader>

      <CardContent
        className={cn(
          "flex flex-col gap-section",
          compact && "px-section",
          contentClassName?.includes("flex-wrap") && "flex-row",
          contentClassName,
        )}
      >
        {children}
      </CardContent>
    </Card>
  );
}
