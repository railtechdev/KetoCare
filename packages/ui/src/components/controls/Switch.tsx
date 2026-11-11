import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

/**
 * Переключатель кита: настройка, которая применяется сразу — отбор списка,
 * напоминание, «показывать выведенные» (docs/PLAN_UI_ORDER_2026-11.md,
 * правило 6). Пункт формы, который уходит по «Сохранить», — `Checkbox`.
 *
 * `className` — для места в раскладке (отступ, выравнивание), он ложится на
 * обёртку; вид самого элемента задаёт кит.
 *
 * Внутри — системный флажок с `role="switch"` (WAI-ARIA APG, Switch):
 * регистрируется формой как обычный флажок и объявляется «включено/выключено».
 */
export function Switch({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type" | "role">) {
  return (
    <span
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center",
        className,
      )}
    >
      <input
        type="checkbox"
        role="switch"
        data-slot="switch"
        className={cn(
          "peer absolute inset-0 cursor-pointer appearance-none rounded-full bg-input transition-colors outline-none",
          "checked:bg-primary",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        {...props}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none relative ml-0.5 size-5 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-5"
      />
    </span>
  );
}
