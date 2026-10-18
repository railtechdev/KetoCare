import { useId, type ReactNode } from "react";

import { cn } from "../lib/cn";

export interface SegmentedControlItem<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  /** Доступная подпись переключателя для скринридера */
  label: string;
  value: T;
  onChange: (value: T) => void;
  items: readonly SegmentedControlItem<T>[];
  name?: string;
  size?: "sm" | "default";
  className?: string;
}

/**
 * Сегментированный переключатель режимов / диапазонов (Apple HIG / Polaris).
 *
 * Заменяет россыпь `Button variant="outline"` там, где пользователь выбирает
 * один из взаимоисключающих вариантов отображения («Неделя | Месяц | Произвольный»,
 * «Вчера | Сегодня | Завтра»). Внутри — нативные радиокнопки, поэтому обход
 * стрелками клавиатуры и чтение скринридером («радиокнопка, выбрано, 1 из 3»)
 * работают из коробки.
 */
export function SegmentedControl<T extends string = string>({
  label,
  value,
  onChange,
  items,
  name,
  size = "default",
  className,
}: SegmentedControlProps<T>) {
  const autoName = useId();
  const groupName = name ?? autoName;

  return (
    <fieldset
      className={cn(
        "m-0 inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-border/80 bg-muted/70 p-1",
        className,
      )}
    >
      <legend className="sr-only">{label}</legend>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <label
            key={item.value}
            className={cn(
              "relative inline-flex cursor-pointer items-center justify-center rounded-lg font-medium whitespace-nowrap transition-all select-none",
              "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              size === "sm"
                ? "min-h-9 px-3 py-1 text-xs"
                : "min-h-touch px-3.5 py-1.5 text-sm",
              active
                ? "bg-card text-foreground shadow-kc-sm"
                : "text-muted-foreground hover:text-foreground",
              item.disabled && "pointer-events-none opacity-50",
            )}
          >
            <input
              type="radio"
              name={groupName}
              value={item.value}
              checked={active}
              disabled={item.disabled}
              aria-label={typeof item.label === "string" ? item.label : undefined}
              onChange={() => onChange(item.value)}
              className="sr-only"
            />
            {item.label}
          </label>
        );
      })}
    </fieldset>
  );
}

