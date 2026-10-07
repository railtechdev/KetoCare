import { Eye } from "lucide-react";
import { type FormEvent, type KeyboardEvent, type ReactNode } from "react";

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
  /**
   * Кто, кроме помощника, прочтёт вопрос. Обязательна: переписку семьи читают
   * ведущие ребёнка специалисты (ADR-0022), и экран, забывший об этом сказать,
   * не должен собираться.
   */
  audience: ReactNode;
  className?: string;
}

/**
 * Поле вопроса и кнопка отправки.
 *
 * Textarea, а не input: вопрос семьи — это две-три строки, и однострочное поле
 * прячет начало написанного. Enter отправляет только там, где есть мышь:
 * на телефоне Enter — это перенос строки, и отправка по нему обрывала бы
 * вопрос на середине.
 *
 * Над полем — кто прочтёт вопрос. Это условие разговора, а не сноска: человек
 * пишет иначе, когда знает, что его читает врач (принцип прозрачности, GDPR
 * ст. 13; порталы пациентов вроде MyChart говорят это у поля сообщения). Строка
 * живёт здесь, а не на экранах, по той же причине, что дисклеймер в
 * `ChatMessage`: собранная на каждом экране, она однажды пропадёт с одного из
 * них. Всегда видна и не сворачивается — одна строка дешевле состояния
 * «прочитано», которое пришлось бы хранить.
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
  audience,
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
      <p className="m-0 flex items-start gap-2 text-sm text-muted-foreground">
        <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{audience}</span>
      </p>
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
