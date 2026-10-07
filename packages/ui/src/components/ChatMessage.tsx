import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@ui/lib/cn";
import { Skeleton } from "./ui/skeleton";

interface ChatMessageCommon {
  children?: ReactNode;
  /** Ответ ещё не пришёл: на его месте ожидание, а не пустота */
  pending?: boolean;
  /** Ответа не было: отказ, шаблон или недоступность — подпись не ставится */
  refusal?: boolean;
  /**
   * Строка над репликой — когда она сказана. Нужна тому, кто читает чужую
   * переписку (специалист в карте пациента): сам собеседник время своего
   * разговора знает, а врачу без него не понять, о каком дне вопрос.
   */
  meta?: ReactNode;
  /**
   * Что сказать, если ответа нет дольше обычного, — словами приложения.
   *
   * Ожидание без конца выглядит как «думает»: при остановленном обработчике
   * скелетон стоял часами, и семья ждала ответа, которого не будет. Через
   * `slowAfterMs` от `pendingSince` (момент вопроса) под ожиданием появляется
   * этот текст — со статусом, чтобы его услышала программа чтения с экрана.
   */
  slowNote?: ReactNode;
  /** Когда задан вопрос; без него отсчёт идёт от появления ожидания на экране. */
  pendingSince?: Date;
  /** Порог «дольше обычного»; по умолчанию 45 секунд. */
  slowAfterMs?: number;
  className?: string;
}

/** Обычный ответ приходит за 5–20 секунд; 45 — с запасом на очередь. */
export const CHAT_SLOW_AFTER_MS = 45_000;

/**
 * Реплика помощника обязана нести подпись — на уровне типов.
 *
 * Дисклеймер под КАЖДЫМ ответом — требование раздела 10.4 ТЗ, и необязательный
 * проп позволял его забыть: экран компилировался и показывал ответ о здоровье
 * ребёнка без слов «не заменяет врача». Без подписи допустимо только
 * ожидание-скелетон (`pending`), под которым подписи и не бывает.
 */
export type ChatMessageProps = ChatMessageCommon &
  (
    | {
        role: "user";
        /** У реплики семьи подписи нет; переданная — не показывается. */
        note?: ReactNode;
      }
    | {
        role: "assistant";
        pending: true;
        note?: ReactNode;
      }
    | {
        role: "assistant";
        /** Строка под ответом: дисклеймер, список статей. */
        note: ReactNode;
      }
  );

/**
 * Сообщение переписки.
 *
 * Своя, а не общая карточка: у сообщения нет заголовка, действий и рамки — это
 * реплика, и всё оформление сводится к тому, чья она и ждём ли мы её.
 *
 * `note` живёт здесь, а не в экране, по одной причине: дисклеймер обязан стоять
 * под КАЖДЫМ ответом помощника (раздел 10.4 ТЗ), а собранный на экране он
 * однажды окажется не под всеми.
 *
 * По той же причине здесь решается и когда подписи НЕ быть: под ожиданием (она
 * стояла бы под пустым местом) и под отказом (она утверждает «ответ по
 * материалам приложения», а ответа не было). Отдай это решение экранам — и
 * кабинет с Mini App однажды разойдутся в том, что считать ответом.
 */
export function ChatMessage({
  role,
  children,
  pending = false,
  note,
  refusal = false,
  meta,
  slowNote,
  pendingSince,
  slowAfterMs = CHAT_SLOW_AFTER_MS,
  className,
}: ChatMessageProps) {
  const own = role === "user";
  const slow = useSlow(
    pending && slowNote !== undefined,
    pendingSince?.getTime(),
    slowAfterMs,
  );

  return (
    <div
      className={cn("flex", own ? "justify-end" : "justify-start", className)}
    >
      <div
        className={cn(
          "flex max-w-[85%] flex-col gap-1 rounded-lg px-3 py-2",
          own
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {meta !== undefined && (
          <span className="text-xs opacity-80">{meta}</span>
        )}
        {pending ? (
          <span aria-busy="true" className="flex flex-col gap-1 py-1">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-24" />
            {slow && (
              <span role="status" className="text-xs">
                {slowNote}
              </span>
            )}
          </span>
        ) : (
          <span className="whitespace-pre-wrap break-words">{children}</span>
        )}

        {!own && note !== undefined && !pending && !refusal && (
          <span className="text-xs opacity-80">{note}</span>
        )}
      </div>
    </div>
  );
}

/** Ожидание длится дольше порога — с учётом того, сколько уже прошло. */
function useSlow(
  active: boolean,
  since: number | undefined,
  afterMs: number,
): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return undefined;
    }
    const left = afterMs - (since === undefined ? 0 : Date.now() - since);
    if (left <= 0) {
      setSlow(true);
      return undefined;
    }
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), left);
    return () => window.clearTimeout(timer);
  }, [active, since, afterMs]);
  return slow;
}
