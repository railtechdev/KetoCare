import { Check } from "lucide-react";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

/**
 * Флажок кита: пункт формы или отметка («съедено», «принят»).
 *
 * `className` — для места в раскладке (отступ, выравнивание), он ложится на
 * обёртку; вид самого элемента задаёт кит.
 *
 * Внутри — системный `<input type="checkbox">` с оформлением shadcn: формы
 * регистрируют его как прежде (`register()`), программа чтения с экрана
 * объявляет его как флажок, а браузер больше не рисует его по-своему.
 * То, что применяется сразу, — не флажок, а `Switch`
 * (docs/PLAN_UI_ORDER_2026-11.md, правило 6).
 */
export function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  return (
    <span
      className={cn(
        "relative inline-grid size-5 shrink-0 place-items-center",
        className,
      )}
    >
      <input
        type="checkbox"
        data-slot="checkbox"
        className={cn(
          "peer col-start-1 row-start-1 size-5 cursor-pointer appearance-none rounded-[5px] border border-input bg-background shadow-xs transition-colors outline-none",
          "checked:border-primary checked:bg-primary",
          "focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-destructive",
        )}
        {...props}
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none col-start-1 row-start-1 size-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100"
      />
    </span>
  );
}
