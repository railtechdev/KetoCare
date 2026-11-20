import { Info } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@ui/lib/cn";
import { ChatText } from "./ChatText";
import { Skeleton } from "./ui/skeleton";

interface ChatMessageCommon {
  /**
   * Текст реплики. Строка ответа помощника показывается через `ChatText`:
   * жирный и короткие списки, остальная разметка снимается, HTML не
   * разбирается никогда (аудит Mini App 2026-11, П5). Реплика семьи — как
   * написана.
   */
  children?: ReactNode;
  /** Ответ ещё не пришёл: на его месте ожидание, а не пустота */
  pending?: boolean;
  /**
   * Что говорит ожидание ответа — «Помощник отвечает…» с движением (П6).
   *
   * Без подписи ожидание рисуется брусками: так выглядит загрузка всей
   * переписки, а не ответ, который вот-вот придёт.
   */
  pendingLabel?: ReactNode;
  /** Ответа не было: отказ, шаблон или недоступность — подпись не ставится */
  refusal?: boolean;
  /**
   * Что делать дальше после отказа (П4): «Спросить ещё раз», телефон клиники.
   * Показывается только под отказом.
   */
  nextStep?: ReactNode;
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
 * Подпись под ответом помощника: что-то, что печатается.
 *
 * `ReactNode` включает `undefined`, `null` и `boolean`, и с ним проходило
 * `note={cond ? t("disclaimer") : undefined}` — ответ без подписи при
 * обязательном пропе. Пустые значения из типа исключены.
 */
export type ChatMessageNote = Exclude<ReactNode, null | undefined | boolean>;

/**
 * Реплика помощника обязана нести подпись — на уровне типов.
 *
 * Дисклеймер под КАЖДЫМ ответом — требование раздела 10.4 ТЗ, и необязательный
 * проп позволял его забыть: экран компилировался и показывал ответ о здоровье
 * ребёнка без слов «не заменяет врача». Без подписи допустимо только
 * ожидание-скелетон (`pending`), под которым подписи и не бывает. Передать
 * вместо подписи `undefined` или `null` тоже нельзя (`ChatMessageNote`).
 */
export type ChatMessageProps = ChatMessageCommon &
  (
    | {
        role: "user";
        /** У реплики семьи подписи нет; переданная — не показывается. */
        note?: ReactNode;
        sources?: ReactNode;
      }
    | {
        role: "assistant";
        pending: true;
        note?: ReactNode;
        sources?: ReactNode;
      }
    | {
        role: "assistant";
        /** Дисклеймер под ответом — своей строкой, мелко. */
        note: ChatMessageNote;
        /**
         * Статьи, по которым дан ответ, — своей строкой над дисклеймером и
         * читаемым размером (П9): прежде оба были одним предложением мелким
         * шрифтом в четыре строки.
         */
        sources?: ReactNode;
      }
  );

/**
 * Сообщение переписки.
 *
 * Своя, а не общая карточка: у сообщения нет заголовка, действий и рамки — это
 * реплика, и всё оформление сводится к тому, чья она и ждём ли мы её. Отказ —
 * исключение: он выглядит иначе, чем ответ (рамка и значок, П4), потому что
 * ответом не является, и под ним стоит следующий шаг.
 *
 * `note` живёт здесь, а не в экране, по одной причине: дисклеймер обязан стоять
 * под КАЖДЫМ ответом помощника (раздел 10.4 ТЗ), а собранный на экране он
 * однажды окажется не под всеми.
 *
 * По той же причине здесь решается и когда подписи НЕ быть: под ожиданием (она
 * стояла бы под пустым местом) и под отказом. Раздел 10.4 ТЗ требует её под
 * каждым ОТВЕТОМ, а отказ ответом не является: он сам ведёт к врачу («Спросите
 * врача на приёме») или говорит о службе, и под ним стоит свой следующий шаг
 * (`nextStep`). Отдай это решение экранам — и кабинет с Mini App однажды
 * разойдутся в том, что считать ответом.
 */
export function ChatMessage({
  role,
  children,
  pending = false,
  pendingLabel,
  note,
  sources,
  refusal = false,
  nextStep,
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
  const body =
    !own && typeof children === "string" ? (
      <ChatText text={children} />
    ) : (
      <span className="whitespace-pre-wrap break-words">{children}</span>
    );

  if (!own && refusal && !pending) {
    return (
      <div className={cn("flex", className)}>
        <div
          data-refusal="true"
          className="flex w-full gap-2 rounded-lg border border-border bg-background px-3 py-2"
        >
          <Info
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {meta !== undefined && (
              <span className="text-xs text-muted-foreground">{meta}</span>
            )}
            {body}
            {nextStep !== undefined && (
              <div className="flex flex-col gap-2 text-sm">{nextStep}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex", own ? "justify-end" : "justify-start", className)}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1 rounded-lg px-3 py-2",
          own
            ? "max-w-[85%] bg-primary text-primary-foreground"
            : "max-w-full bg-muted text-foreground",
        )}
      >
        {meta !== undefined && (
          <span className="text-xs opacity-80">{meta}</span>
        )}
        {pending ? (
          <span aria-busy="true" className="flex flex-col gap-1 py-1">
            {pendingLabel !== undefined ? (
              <span role="status" className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm">
                  {pendingLabel}
                  <TypingDots />
                </span>
                {slow && <span className="text-xs">{slowNote}</span>}
              </span>
            ) : (
              <>
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-24" />
                {slow && (
                  <span role="status" className="text-xs">
                    {slowNote}
                  </span>
                )}
              </>
            )}
          </span>
        ) : (
          body
        )}

        {!own && !pending && !refusal && sources !== undefined && (
          <div className="mt-1 text-sm">{sources}</div>
        )}
        {!own && note !== undefined && !pending && !refusal && (
          <span className="text-xs opacity-80">{note}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Три точки «печатает». Движутся только у тех, кто не просил меньше движения
 * (`motion-safe:`); при `prefers-reduced-motion` стоят на месте.
 */
function TypingDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          data-typing-dot=""
          className="size-1.5 rounded-full bg-current opacity-60 motion-safe:animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
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
