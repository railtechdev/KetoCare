import { AlertTriangle } from "lucide-react";

import { Button } from "./ui/button";
import { cn } from "../lib/cn";

export interface ErrorStateProps {
  title: string;
  description?: string;
  /** Подпись кнопки повтора; без обработчика кнопка не показывается */
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * Ошибка загрузки данных — с выходом.
 *
 * Отличается от ошибки формы (`FormError`) намеренно: запрос упал — его можно
 * повторить, и кнопка «Повторить» здесь главное. Раньше оба случая шли в один
 * красный блок и штабелировались по три подряд, а повторить было нечем: только
 * перезагрузка страницы.
 */
export function ErrorState({
  title,
  description,
  retryLabel,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-destructive"
        />
        <div>
          <p className="m-0 font-semibold text-foreground">{title}</p>
          {description && (
            <p className="m-0 mt-1 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>

      {onRetry && retryLabel && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
