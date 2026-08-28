import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@ketocare/ui";

interface FieldBaseProps {
  label: string;
  /** Текст ошибки; связывается с полем через aria-describedby */
  error?: ReactNode;
}

/**
 * Поля формы: строка, список, многострочный текст.
 *
 * Три вида лежат в одном модуле и делят обвязку осознанно. Различаются они
 * только элементом управления, а совпадают в том, что важно, — в связи подписи,
 * поля и сообщения об ошибке. Пока копий было три, исправление этой связи в
 * одной из них не доходило до двух других, и незрячий пользователь узнавал об
 * ошибке ввода не везде.
 *
 * forwardRef обязателен: `register()` из react-hook-form передаёт `ref`, а
 * функциональный компонент в React 18 не получает его пропом — ref молча
 * терялся, библиотека не видела поле и считала его пустым даже при заполненном
 * значении.
 */
/**
 * Оформление элемента ввода. Экспортируется, потому что поиск, фильтры и
 * переключатели периода — это не поля формы с подписью и ошибкой, но выглядеть
 * они обязаны так же. Пока строка классов была скопирована по девяти файлам,
 * копии успели разойтись в отступах и цвете текста.
 */
export const FIELD_CONTROL =
  "min-h-touch w-full rounded-lg border border-border bg-card px-3 py-2.5 text-foreground";

function errorIdOf(id: string | undefined, error: ReactNode) {
  return error ? `${id}-error` : undefined;
}

/** Атрибуты, одинаковые у input, select и textarea. */
function controlProps(
  id: string | undefined,
  error: ReactNode,
  className: string | undefined,
) {
  return {
    id,
    className: cn(FIELD_CONTROL, error && "border-destructive", className),
    "aria-invalid": error ? true : undefined,
    "aria-describedby": errorIdOf(id, error),
  } as const;
}

function FieldShell({
  label,
  error,
  id,
  children,
}: FieldBaseProps & { id?: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {children}
      {error && (
        <p id={errorIdOf(id, error)} className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export const Field = forwardRef<
  HTMLInputElement,
  FieldBaseProps & InputHTMLAttributes<HTMLInputElement>
>(function Field({ label, error, id, className, ...props }, ref) {
  return (
    <FieldShell label={label} error={error} id={id}>
      <input ref={ref} {...controlProps(id, error, className)} {...props} />
    </FieldShell>
  );
});

export const SelectField = forwardRef<
  HTMLSelectElement,
  FieldBaseProps & SelectHTMLAttributes<HTMLSelectElement>
>(function SelectField(
  { label, error, id, className, children, ...props },
  ref,
) {
  return (
    <FieldShell label={label} error={error} id={id}>
      <select ref={ref} {...controlProps(id, error, className)} {...props}>
        {children}
      </select>
    </FieldShell>
  );
});

export const TextAreaField = forwardRef<
  HTMLTextAreaElement,
  FieldBaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextAreaField({ label, error, id, className, ...props }, ref) {
  return (
    <FieldShell label={label} error={error} id={id}>
      <textarea ref={ref} {...controlProps(id, error, className)} {...props} />
    </FieldShell>
  );
});
