import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * Оболочка поля для экранов, где формы нет библиотекой: подпись, пометка
 * «необязательно», пояснение и ошибка — и их связь с полем.
 *
 * Важна не разметка, а связь: подпись оборачивает поле (имя поля — её текст),
 * пояснение и ошибка подключаются через `aria-describedby`, ошибка объявляется
 * сразу (`role="alert"`). В Mini App такая оболочка была написана пятью
 * копиями — в правке записи дневника, в сборке дня, в калькуляторе, во входе
 * в кабинет, — и в двух из них пояснение лежало внутри `label`, то есть
 * читалось программой чтения как часть имени поля.
 *
 * Пометка «необязательно» приходит словами приложения: у кита нет словаря
 * (ADR-0052).
 */
export function FieldShell({
  label,
  optionalLabel,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  /** Слово «необязательно» на языке экрана; не передано — поле обязательное. */
  optionalLabel?: string;
  hint?: ReactNode;
  error?: ReactNode | false;
  className?: string;
  children: (ids: {
    describedBy: string | undefined;
    invalid: true | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hasError = error !== undefined && error !== false && error !== null;
  const describedBy =
    [hint ? hintId : null, hasError ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="flex flex-col gap-1">
        <span>
          {label}
          {optionalLabel !== undefined && (
            <>
              {" "}
              <span className="text-muted-foreground">({optionalLabel})</span>
            </>
          )}
        </span>
        {children({ describedBy, invalid: hasError ? true : undefined })}
      </label>
      {hint && (
        <span id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </span>
      )}
      {hasError && (
        <span id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Системный список выбора — для телефона.
 *
 * Не `Select` кита: в встроенном браузере Telegram всплывающий слой Radix
 * приходится держать самому (прокрутка под ним, фокус, «Назад»), а системный
 * список открывает родное колесо выбора iOS и Android. Одно оформление на все
 * такие списки — до него их было пять копий с разными рамками.
 */
export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "min-h-touch min-w-0 rounded-xl border border-input bg-card px-3 text-foreground",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
