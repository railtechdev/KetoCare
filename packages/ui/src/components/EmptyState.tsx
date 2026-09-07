import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  /** Что здесь появится и как это заполнить */
  description?: ReactNode;
  /** Кнопка действия: пустое состояние без выхода — тупик */
  action?: ReactNode;
  /**
   * `block` — единственное пустое состояние экрана: рамка, значок, объяснение.
   * `inline` — строка: блок, которому нечего показать, когда о пустоте экрана
   * уже сказано в другом месте (правило П27 канона).
   *
   * Размер существует потому, что правило П27 («пустому блоку не нужна
   * высота») было записано, но обеспечить его было нечем: у пустого состояния
   * форма была одна. Пустой день в меню рисовал четыре рамки «Блюд пока нет»,
   * дневник — два пустых состояния подряд, а выбор ребёнка — пунктирный
   * прямоугольник 1616 x 290 px.
   */
  size?: "block" | "inline";
  className?: string;
}

/**
 * Пустое состояние экрана или списка.
 *
 * Три части обязательны по смыслу: что здесь будет, как это заполнить и чем.
 * Серый абзац «Записей пока нет» без объяснения и без действия оставляет
 * пользователя в тупике — а таких абзацев в приложении было большинство.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "block",
  className,
}: EmptyStateProps) {
  if (size === "inline") {
    // Значка нет намеренно: значок нужен, чтобы объяснить пустой экран, а здесь
    // объяснять нечего — строка стоит внутри блока, который сам себя называет.
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-field text-sm text-muted-foreground",
          className,
        )}
      >
        <span>{title}</span>
        {description && <span>{description}</span>}
        {action}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-6" />
        </span>
      )}
      <p className="m-0 font-semibold text-foreground">{title}</p>
      {description && (
        <p className="m-0 max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
