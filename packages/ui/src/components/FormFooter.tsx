import { useId, type ReactNode } from "react";

import { ActionReason } from "./ActionReason";
import { Button } from "./ui/button";
import { cn } from "../lib/cn";

export interface FormFooterProps {
  submitLabel: string;
  /** Подпись на время отправки: «Сохранить» → «Сохраняем…» */
  pendingLabel: string;
  pending?: boolean;
  disabled?: boolean;
  /**
   * Чего не хватает, чтобы отправить форму, — когда `disabled` стоит не из-за
   * отправки, а из-за незаполненного (правило П44 канона).
   *
   * Живёт здесь, а не на экране, ровно потому, что иначе о нём забывают: у
   * подвала уже есть `disabled`, и причина обязана идти с ним рядом.
   */
  reason?: ReactNode;
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
  reason,
  cancelLabel,
  onCancel,
  className,
  extra,
}: FormFooterProps) {
  const reasonId = useId();
  // Причина показывается, только когда она и есть препятствие: во время
  // отправки кнопка тоже выключена, но объяснять там нечего.
  const blocked = disabled && !pending && reason !== undefined;

  return (
    <div
      data-slot="form-footer"
      className={cn(
        "flex flex-col gap-field",
        // В боковой панели действия закреплены внизу (Material, Fluent,
        // shadcn Sheet): в длинной форме до «Сохранить» не прокручивают, в
        // короткой кнопки не висят посреди панели.
        "[[data-slot=sheet-content]_&]:sticky [[data-slot=sheet-content]_&]:bottom-0 [[data-slot=sheet-content]_&]:z-10 [[data-slot=sheet-content]_&]:-mx-4 [[data-slot=sheet-content]_&]:-mb-4 [[data-slot=sheet-content]_&]:mt-auto [[data-slot=sheet-content]_&]:border-t [[data-slot=sheet-content]_&]:border-border [[data-slot=sheet-content]_&]:bg-background [[data-slot=sheet-content]_&]:px-4 [[data-slot=sheet-content]_&]:py-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* min-h-touch явно: кнопка подтверждения формы — то, во что целятся
          чаще всего, и 36 px кита здесь мало даже на мыши (раздел 8.2 ТЗ). */}
        <Button
          type="submit"
          className="min-h-touch"
          disabled={pending || disabled}
          aria-busy={pending}
          aria-describedby={blocked ? reasonId : undefined}
        >
          {pending ? pendingLabel : submitLabel}
        </Button>

        {cancelLabel && onCancel && (
          <Button
            type="button"
            variant="outline"
            className="min-h-touch"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
        )}

        {extra && <span className="ml-auto">{extra}</span>}
      </div>

      {/* Область постоянна: живая область, добавленная вместе с текстом,
          озвучивается не всеми программами чтения с экрана. */}
      <ActionReason id={reasonId}>{blocked ? reason : null}</ActionReason>
    </div>
  );
}
