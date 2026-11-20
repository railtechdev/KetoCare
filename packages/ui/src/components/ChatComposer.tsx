import { ChevronDown, Eye, LoaderCircle, SendHorizontal } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cn } from "@ui/lib/cn";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

/**
 * Кто, кроме помощника, прочтёт вопрос.
 *
 * `summary` — одна короткая строка, видна всегда («Вопросы видят врач и
 * диетолог»). `details` — что открывается по кнопке `detailsLabel` («Кто
 * именно»): имена, «уведомлений они не получают — о срочном звоните в
 * клинику», телефон клиники.
 */
export type ChatAudience =
  | { summary: ReactNode; details?: undefined; detailsLabel?: undefined }
  | { summary: ReactNode; details: ReactNode; detailsLabel: string };

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
  /** Строка под полем. Экраны помощника её больше не передают (П2). */
  hint?: string;
  /**
   * Кто, кроме помощника, прочтёт вопрос. Обязательна: переписку семьи читают
   * ведущие ребёнка специалисты (ADR-0022), и экран, забывший об этом сказать,
   * не должен собираться.
   */
  audience: ChatAudience;
  /**
   * Поле получило или потеряло фокус — Mini App прячет полосу вкладок.
   *
   * Потеря фокуса сообщается ПОСЛЕ нажатия, которое её вызвало, и только если
   * фокус в поле не вернулся: см. `onFieldBlur`.
   */
  onFocusChange?: (focused: boolean) => void;
  className?: string;
}

/** Есть ли у движка `field-sizing: content` — поле растёт само, без расчёта. */
function sizesItself(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("field-sizing", "content")
  );
}

/**
 * Поле вопроса и кнопка отправки — одной строкой (аудит Mini App 2026-11, П2).
 *
 * Поле в одну строку растёт по мере набора до четырёх и дальше прокручивается:
 * вопрос семьи — это две-три строки, и однострочное поле прятало бы начало
 * написанного, а высокое — съедало переписку. Прежняя раскладка (строка о
 * читателях, поле, подсказка, кнопка) занимала 290 px из 844, с открытой
 * клавиатурой переписки не было видно вовсе. Кнопка — значок с подписью для
 * программы чтения с экрана, размером не меньше касания.
 *
 * Enter отправляет только там, где есть мышь: на телефоне Enter — это перенос
 * строки, и отправка по нему обрывала бы вопрос на середине.
 *
 * Над полем — кто прочтёт вопрос. Это условие разговора, а не сноска: человек
 * пишет иначе, когда знает, что его читает врач (принцип прозрачности, GDPR
 * ст. 13; порталы пациентов вроде MyChart говорят это у поля сообщения).
 * Строка живёт здесь, а не на экранах, по той же причине, что дисклеймер в
 * `ChatMessage`: собранная на каждом экране, она однажды пропадёт с одного из
 * них.
 *
 * Видна всегда ОДНА строка — кто читает; подробности (имена, «о срочном
 * звоните в клинику», телефон) раскрываются по нажатию. Прежде строка не
 * сворачивалась никогда и занимала пять строк над полем; 20.11.2026 владелец
 * решил свернуть её до одной (решение Р1 аудита). Гарантия осталась прежней:
 * без `audience.summary` экран не собирается.
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
  onFocusChange,
  className,
}: ChatComposerProps) {
  const empty = value.trim().length === 0;
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const blurTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(blurTimer.current), []);

  function onFieldFocus() {
    window.clearTimeout(blurTimer.current);
    blurTimer.current = undefined;
    onFocusChange?.(true);
  }

  // The loss of focus is reported after the tap that caused it. On Android
  // a tap on «Спросить» or «Кто именно» focuses the button on mousedown, so
  // the field blurs mid-tap. Reported at once, it brought the tab bar back and
  // moved the composer 4rem up before mouseup: the click then landed on the
  // tab bar and the question was not sent. Chromium dispatches mousedown,
  // mouseup and click of a tap in one task, so the next task is after the
  // click. If focus came back to the field by then, nothing is reported.
  function onFieldBlur(event: FocusEvent<HTMLTextAreaElement>) {
    if (onFocusChange === undefined) return;
    const field = event.currentTarget;
    window.clearTimeout(blurTimer.current);
    blurTimer.current = window.setTimeout(() => {
      blurTimer.current = undefined;
      if (field.ownerDocument.activeElement !== field) onFocusChange(false);
    }, 0);
  }

  // Рост поля там, где `field-sizing` нет (Safari, WebView iOS): высота по
  // содержимому, но не выше `max-height` — дальше поле прокручивается.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (field === null || sizesItself()) return;
    field.style.height = "auto";
    if (field.scrollHeight === 0) {
      field.style.height = "";
      return;
    }
    const style = getComputedStyle(field);
    const borders =
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const max = parseFloat(style.maxHeight);
    const wanted =
      field.scrollHeight + (Number.isFinite(borders) ? borders : 0);
    field.style.height = `${Number.isFinite(max) ? Math.min(wanted, max) : wanted}px`;
  }, [value]);

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
    <form onSubmit={submit} className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-col gap-1 text-sm text-muted-foreground">
        <p className="m-0 flex flex-wrap items-center gap-x-2">
          <Eye aria-hidden="true" className="size-4 shrink-0" />
          <span>{audience.summary}</span>
          {audience.details !== undefined && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => setOpen((current) => !current)}
              className="inline-flex min-h-touch items-center gap-1 text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {audience.detailsLabel}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 motion-safe:transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          )}
        </p>
        {audience.details !== undefined && (
          <div
            id={detailsId}
            hidden={!open}
            className="flex flex-col gap-1 ps-6"
          >
            {audience.details}
          </div>
        )}
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          ref={fieldRef}
          rows={1}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          // Четыре строки и поля: дальше поле прокручивается, а не растёт.
          className="min-h-touch max-h-[calc(4lh+1rem+2px)] resize-none"
        />
        <Button
          type="submit"
          size="icon"
          disabled={empty || pending || disabled}
          aria-busy={pending}
          aria-label={pending ? sendingLabel : sendLabel}
          className="size-(--spacing-touch) shrink-0"
        >
          {pending ? (
            <LoaderCircle
              aria-hidden="true"
              className="motion-safe:animate-spin"
            />
          ) : (
            <SendHorizontal aria-hidden="true" />
          )}
        </Button>
      </div>
      {hint !== undefined && (
        <p className="m-0 text-xs text-muted-foreground">{hint}</p>
      )}
    </form>
  );
}
