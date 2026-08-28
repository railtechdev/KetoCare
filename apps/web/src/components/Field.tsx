import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@ketocare/ui";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Текст ошибки; связывается с полем через aria-describedby */
  error?: ReactNode;
}

/**
 * Поле формы с подписью и доступным сообщением об ошибке.
 *
 * forwardRef обязателен: `register()` из react-hook-form передаёт `ref`, а
 * функциональный компонент в React 18 не получает его пропом — ref молча
 * терялся, библиотека не видела инпут и считала поле пустым даже при
 * заполненном значении.
 */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, id, className, ...inputProps },
  ref,
) {
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        className={cn(
          "min-h-touch w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-ink",
          error && "border-danger",
          className,
        )}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        {...inputProps}
      />
      {error && (
        <p id={errorId} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
