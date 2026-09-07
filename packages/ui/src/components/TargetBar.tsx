import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { Progress } from "./ui/progress";

export interface TargetBarProps {
  label: ReactNode;
  /** Сколько набрано на сейчас */
  value: number;
  /** Сколько нужно набрать (`goal`) или сколько нельзя превышать (`limit`) */
  target: number;
  /**
   * `goal` — цель, которую набирают: калорийность дня. Заполнение — хорошо.
   * `limit` — предел, который нельзя превышать: углеводы. Заполнение —
   * приближение к границе.
   *
   * Разница не косметическая: полная полоса калорийности означает «день
   * собран», полная полоса углеводов — «больше нельзя». Одним видом их
   * показывать нельзя.
   */
  kind: "goal" | "limit";
  /** Готовая строка «X из Y ед.» — формат чисел и единицы знает вызывающий */
  valueText: ReactNode;
  /** Готовая строка «осталось N» либо «сверх нормы N» */
  hint: ReactNode;
  className?: string;
}

/**
 * Цель дня полосой, а не только словами.
 *
 * Правило П18 канона требует показывать «осталось», а не только «съедено», — и
 * оно выполнялось текстом: «осталось 910,5 ккал». Родитель, который не обязан
 * иметь опыт работы с интерфейсами, читал числа и складывал их в уме, хотя
 * ответ на вопрос «сколько дня ещё осталось» — это ровно полоса.
 *
 * `Progress` берётся у кита: он стоял установленным и не использовался ни разу.
 * Цвет заливки меняется снаружи, через `data-slot` компонента кита, — файлы
 * кита править нельзя, они переписываются при обновлении.
 *
 * **Порог только один — факт превышения.** Ни «почти достигнуто», ни «зона
 * риска» здесь не появятся: это клинические пороги, а их назначает медицинская
 * команда, а не интерфейс (правило 1 CLAUDE.md).
 */
export function TargetBar({
  label,
  value,
  target,
  kind,
  valueText,
  hint,
  className,
}: TargetBarProps) {
  const over = target > 0 && value > target;
  // Полоса не уходит за 100%: `Progress` ждёт 0..100, а превышение сообщается
  // цветом и подписью — не растянутой за край заливкой.
  const percent =
    target > 0 ? Math.min(100, Math.max(0, (value / target) * 100)) : 0;

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-block gap-y-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{valueText}</span>
      </div>

      <Progress
        value={percent}
        // Превышение всегда окрашено, потому что оно всегда значимо. Для предела
        // это выход за назначенную границу, для цели — перебор по калорийности.
        // Цвет при этом НЕ единственный носитель смысла: то же самое сказано
        // подписью ниже (WCAG 1.4.1).
        className={cn(
          "mt-2",
          over &&
            (kind === "limit"
              ? "[&_[data-slot=progress-indicator]]:bg-destructive"
              : "[&_[data-slot=progress-indicator]]:bg-warning"),
        )}
      />

      <p className="m-0 mt-1 text-sm text-muted-foreground tabular-nums">
        {hint}
      </p>
    </div>
  );
}
