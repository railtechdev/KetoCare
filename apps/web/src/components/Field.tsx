import { Input, Label, Textarea, cn } from "@ketocare/ui";
import type { ComponentProps, ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * Ширина поля показывает, сколько ждут ввести.
 *
 * Пока все поля были одной ширины, «Пол» с двумя вариантами, дата рождения и
 * рост в три цифры растягивались на 672 px наравне с именем — и поле переставало
 * что-либо подсказывать. Приём и шкала взяты у GOV.UK Design System
 * (`govuk-input--width-*`), значения — в токенах темы.
 *
 * Ограничение действует с ширины `sm` и выше: на телефоне поле занимает строку
 * целиком, там сужать нечего.
 */
export type FieldWidth =
  "tiny" | "narrow" | "date" | "medium" | "wide" | "full";

const WIDTH_CLASS: Record<FieldWidth, string> = {
  tiny: "sm:max-w-field-tiny",
  narrow: "sm:max-w-field-narrow",
  date: "sm:max-w-field-date",
  medium: "sm:max-w-field-medium",
  wide: "sm:max-w-field-wide",
  full: "",
};

interface FieldBaseProps {
  label: string;
  /** Текст ошибки; связывается с полем через aria-describedby */
  error?: ReactNode;
  /** Пояснение под полем: единицы, формат, откуда взять значение */
  hint?: ReactNode;
  /** Помечается необязательное поле, а не обязательное звёздочкой:
      в клинических формах обязательно почти всё (правило П7 UI-канона). */
  optional?: boolean;
  /** Сколько знаков ждут ввести; по умолчанию — вся ширина формы */
  width?: FieldWidth;
}

/**
 * Поля формы: строка, список, многострочный текст.
 *
 * Разметка целиком берётся у кита (`Input`, `Select`, `Textarea`, `Label`);
 * здесь остаётся только то, чего в ките нет и что важнее вида, — связь подписи,
 * пояснения и сообщения об ошибке. Пока эта обвязка была скопирована по трём
 * файлам, исправление связи в одной копии не доходило до двух других, и
 * незрячий пользователь узнавал об ошибке не везде.
 *
 * `ref` передаётся обычным свойством: под React 19 функциональный компонент
 * получает его напрямую, и `forwardRef` больше не нужен.
 */
export const FIELD_CONTROL =
  "min-h-touch w-full rounded-lg border border-input bg-card px-3 py-2.5 text-foreground";

function useDescribedBy(
  id: string | undefined,
  error: ReactNode,
  hint: ReactNode,
) {
  const parts = [
    error ? `${id}-error` : null,
    hint ? `${id}-hint` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(" ") : undefined;
}

function FieldShell({
  label,
  error,
  hint,
  optional,
  id,
  children,
}: FieldBaseProps & { id?: string; children: ReactNode }) {
  const { t } = useTranslation();

  return (
    // gap-field — между подписью, полем и пояснением; mb-block — между самими
    // полями. Отступ снизу был потерян при переходе на кит, и поля в формах
    // слиплись: пояснение под одним полем читалось как подпись к следующему.
    <div className="mb-block flex flex-col gap-field">
      <Label htmlFor={id}>
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground">
            {t("form.optional")}
          </span>
        )}
      </Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  optional,
  id,
  className,
  width = "full",
  ...props
}: FieldBaseProps & ComponentProps<"input">) {
  return (
    <FieldShell
      label={label}
      error={error}
      hint={hint}
      optional={optional}
      id={id}
    >
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={useDescribedBy(id, error, hint)}
        className={cn("min-h-touch", WIDTH_CLASS[width], className)}
        {...props}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  error,
  hint,
  optional,
  id,
  className,
  width = "full",
  children,
  ...props
}: FieldBaseProps & ComponentProps<"select">) {
  return (
    <FieldShell
      label={label}
      error={error}
      hint={hint}
      optional={optional}
      id={id}
    >
      {/* Нативный select, а не составной Select кита: он работает с
          `register()` из react-hook-form напрямую и открывается системным
          списком на телефоне. Составной нужен там, где требуется поиск или
          свои строки — там он и берётся из кита отдельно. */}
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={useDescribedBy(id, error, hint)}
        className={cn(FIELD_CONTROL, WIDTH_CLASS[width], className)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  error,
  hint,
  optional,
  id,
  className,
  width = "full",
  ...props
}: FieldBaseProps & ComponentProps<"textarea">) {
  return (
    <FieldShell
      label={label}
      error={error}
      hint={hint}
      optional={optional}
      id={id}
    >
      <Textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={useDescribedBy(id, error, hint)}
        className={cn(WIDTH_CLASS[width], className)}
        {...props}
      />
    </FieldShell>
  );
}
