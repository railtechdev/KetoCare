import type { ReactNode } from "react";

import { Button } from "./ui/button";
import { cn } from "../lib/cn";

export interface FormFooterProps {
  submitLabel: string;
  /** Подпись на время отправки: «Сохранить» → «Сохраняем…» */
  pendingLabel: string;
  pending?: boolean;
  disabled?: boolean;
  cancelLabel?: string;
  onCancel?: () => void;
  className?: string;
  /** Дополнительное действие слева от кнопок (например, удаление) */
  extra?: ReactNode;
}

/**
 * Подвал формы.
 *
 * Порядок и вид кнопок одинаковы во всех формах: подтверждение первым, отмена
 * рядом. Раньше в приложении сосуществовало шесть схем расположения — где-то
 * кнопка на всю ширину, где-то в правом углу, где-то отмена шла первой.
 *
 * На время отправки кнопка блокируется и меняет подпись: без этого пользователь
 * не знает, приняли у него форму или нет, и нажимает второй раз.
 */
export function FormFooter({
  submitLabel,
  pendingLabel,
  pending = false,
  disabled = false,
  cancelLabel,
  onCancel,
  className,
  extra,
}: FormFooterProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <Button type="submit" disabled={pending || disabled} aria-busy={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>

      {cancelLabel && onCancel && (
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}

      {extra && <span className="ml-auto">{extra}</span>}
    </div>
  );
}
