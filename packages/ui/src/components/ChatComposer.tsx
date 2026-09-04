import { type FormEvent, type KeyboardEvent } from "react";

import { cn } from "@ui/lib/cn";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  sendLabel: string;
  sendingLabel: string;
  /** Отправка идёт: поле остаётся, кнопка занята */
  pending?: boolean;
  /** Спрашивать нельзя — исчерпан предел или помощник недоступен */
  disabled?: boolean;
  hint?: string;
  className?: string;
}

/**
 * Поле вопроса и кнопка отправки.
 *
 * Textarea, а не input: вопрос семьи — это две-три строки, и однострочное поле
 * прячет начало написанного. Enter отправляет только там, где есть мышь:
 * на телефоне Enter — это перенос строки, и отправка по нему обрывала бы
 * вопрос на середине.
 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
  sendLabel,
  sendingLabel,
  pending = false,
  disabled = false,
  hint,
  className,
}: ChatComposerProps) {
  const empty = value.trim().length === 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (empty || pending || disabled) return;
    onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const withMouse =
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: fine)").matches;
    if (!withMouse || event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (!empty && !pending && !disabled) onSubmit();
  }

  return (
    <form
      onSubmit={submit}
      className={cn("flex flex-col gap-field", className)}
    >
      <Textarea
        rows={2}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {hint !== undefined && (
        <p className="m-0 text-xs text-muted-foreground">{hint}</p>
      )}
      <Button
        type="submit"
        disabled={empty || pending || disabled}
        aria-busy={pending}
        className="min-h-touch self-end"
      >
        {pending ? sendingLabel : sendLabel}
      </Button>
    </form>
  );
}
