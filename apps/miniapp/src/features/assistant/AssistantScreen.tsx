import {
  AsyncSection,
  Button,
  ChatComposer,
  ChatDayDivider,
  ChatMessage,
  ChatSources,
  ChatStarters,
  ChatText,
  FormSheet,
  Skeleton,
  chatAudienceRoles,
  chatReadersList,
  cn,
  isRefusal,
  refusalNextStep,
  useAttemptKey,
  useFrozenAttempt,
  withChatDays,
  type ChatSourceArticle,
} from "@ketocare/ui";
import { RotateCcw } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { currentLanguage } from "../../lib/i18n";
import { KeyboardContext } from "../../lib/keyboard";
import { hideKeyboard } from "../../lib/telegram";
import {
  TabVisibleContext,
  useTelegramBack,
  useUnsavedGuard,
} from "../../lib/useTelegram";
import { today } from "../menu/useMenu";
import { ClinicPhone } from "../clinic/ClinicPhone";
import { useClinicPhone } from "../clinic/useClinicPhone";
import type { Session } from "../session/useSession";
import {
  type AssistantMessage,
  answerExpired,
  useArticle,
  useAskAssistant,
  useCareTeam,
  useConversation,
  useLatestConversationId,
} from "./useAssistant";

/**
 * Готовые вопросы на пустом экране (П7, решение Р5).
 *
 * Подпись кнопки — на языке экрана (`starters.<ключ>.label`), а уходит вопрос
 * из ключа `starters.<ключ>.ask`, который по-русски в ОБОИХ словарях: база
 * знаний помощника русская, и узбекский вопрос находил бы меньше. Перевести
 * `ask` в узбекском словаре — значит сломать готовые вопросы узбекской семье.
 */
const STARTERS = [
  "seizure",
  "menu",
  "fixEntry",
  "invite",
  "reminders",
  "dishMismatch",
] as const;

/** Зазор между концом переписки и полем вопроса, px. */
const END_GAP = 8;

/**
 * Помощник семьи в Mini App (раздел 10.4 ТЗ, п. 20 этапа 4).
 *
 * Тот же помощник, что в кабинете, и намеренно тот же: правила, дисклеймер и
 * границы живут на сервере и в ките, а экран лишь показывает переписку. Своя
 * логика здесь означала бы, что в чате помощник ведёт себя иначе, чем в
 * кабинете, — а отвечает он про здоровье ребёнка.
 *
 * Ответ приходит не сразу (ADR-0022): экран дочитывает переписку, пока
 * «ожидание» не сменится ответом.
 *
 * Раскладка — для телефона (аудит Mini App 2026-11): переписка во всю ширину
 * без карточки и второго видимого заголовка (П3), поле вопроса одной строкой
 * прижато к низу (П2), а конец переписки всегда стоит НАД полем (П1).
 */
export function AssistantScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  // Выбор человека сильнее подставленного умолчания; `null` — «ещё не знаем».
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const latest = useLatestConversationId(session.patientId);
  const conversationId = chosenId ?? latest.data ?? null;
  const [question, setQuestion] = useState("");
  const [article, setArticle] = useState<ChatSourceArticle | null>(null);

  const conversation = useConversation(session.patientId, conversationId);
  const ask = useAskAssistant(session.patientId);
  // Пока имена не пришли или не пришли вовсе — строка о ролях: молчать о том,
  // что вопрос прочтут, нельзя ни в одном состоянии.
  const careTeam = useCareTeam(session.patientId);
  const readers = chatReadersList(
    careTeam.data,
    (role) => t(`assistant.audience.role.${role}`, { defaultValue: role }),
    currentLanguage() === "uz" ? "uz-Latn" : "ru",
  );
  const phone = useClinicPhone();

  // Ожидание старше трёх минут показывается отказом с «Спросить ещё раз»,
  // а не вечным «Помощник отвечает…» (аудит 26.11.2026, 2.18). Часы тикают,
  // только пока есть чего ждать.
  const now = useNow(
    (conversation.data ?? []).some((message) => message.status === "pending"),
  );
  const messages = (conversation.data ?? []).map((message) =>
    answerExpired(message, now)
      ? { ...message, status: "failed" as const, text: t("assistant.timedOut") }
      : message,
  );
  // Свежайший разговор не прочитан, а свой разговор человек не выбирал —
  // показывать «пусто» значит утверждать то, чего мы не знаем.
  const latestFailed = latest.isError && chosenId === undefined;
  // Недописанный вопрос: Telegram спросит, прежде чем закрыться.
  useUnsavedGuard(question.trim() !== "");
  // Дневной предел вопросов приходит ответом в переписке (`limited`), а не
  // отказом отправки: прежде поле не выключалось, хотя статья обещала это.
  // А минутный предел частоты (429) выключал поле до полуночи — теперь он
  // обычная ошибка отправки (аудит 26.11.2026, 2.19).
  const lastMessage = messages.at(-1);
  const limited =
    lastMessage?.role === "assistant" &&
    lastMessage.limited === true &&
    today(new Date(lastMessage.created_at)) === today();

  // Предел вопросов — суточный: в полночь он снят, и поле должно включиться
  // само. Прежде отказ «на сегодня вопросов больше нет» висел до перезапуска
  // приложения, хоть бы и через три дня.
  const { reset } = ask;
  const [day, setDay] = useState(today);
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    const timer = setTimeout(
      () => {
        reset();
        setDay(today());
      },
      midnight.getTime() - now.getTime() + 1_000,
    );
    return () => clearTimeout(timer);
  }, [day, reset]);

  // Клавиатура: пока поле в фокусе на телефоне, полоса вкладок скрыта, и поле
  // встаёт к нижнему краю. Ушли с вкладки — полоса возвращается.
  const visible = useContext(TabVisibleContext);
  const keyboard = useContext(KeyboardContext);
  const { report } = keyboard;
  useEffect(() => {
    if (!visible) report(false);
  }, [visible, report]);
  useEffect(() => () => report(false), [report]);

  // Сколько места снизу занимает поле вопроса вместе с полосой вкладок под
  // ним. Это поле прибавляется к концу переписки как `scroll-margin-bottom`:
  // `scrollIntoView` ставил конец на нижний край окна — под поле и полосу,
  // и новый ответ приходилось искать пальцем (П1).
  const composerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<HTMLDivElement>(null);
  const space = useRef(0);
  const measure = useCallback(() => {
    const composer = composerRef.current;
    if (composer === null) return;
    const offset = parseFloat(getComputedStyle(composer).bottom);
    space.current =
      composer.getBoundingClientRect().height +
      (Number.isFinite(offset) ? offset : 0) +
      END_GAP;
    if (endRef.current !== null) {
      endRef.current.style.scrollMarginBottom = `${space.current}px`;
    }
  }, []);
  useLayoutEffect(() => {
    measure();
    const composer = composerRef.current;
    if (composer === null || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [measure, keyboard.open]);

  // К концу переписки — после вопроса, когда пришёл ответ и когда вкладку
  // открывают. Длинный ответ, не влезающий над полем, показывается С НАЧАЛА:
  // конец ответа без начала читать нечего.
  const last = messages.at(-1);
  const lastKey = `${messages.length}:${last?.status ?? ""}`;
  useLayoutEffect(() => {
    if (!visible) return;
    measure();
    const answer = lastRef.current;
    const room = window.innerHeight - space.current - END_GAP;
    if (
      last?.role === "assistant" &&
      last.status !== "pending" &&
      answer !== null &&
      answer.getBoundingClientRect().height > room
    ) {
      answer.scrollIntoView?.({ block: "start" });
      return;
    }
    endRef.current?.scrollIntoView?.({ block: "end" });
    // `last` — по ключу: тот же ответ не должен прокручивать экран заново.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey, visible, measure]);

  // Stay at the end while the conversation grows under the reader: the
  // «дольше обычного» note and the answer replacing the wait change the
  // height without a new message, and the end slid under the composer. Only
  // when the end was in view — a parent reading older replies is not pulled.
  const listRef = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  // The list mounts with the first message, after the loading skeleton.
  const hasMessages = messages.length > 0;
  useEffect(() => {
    const onScroll = () => {
      const end = endRef.current;
      if (end === null) return;
      atEnd.current =
        end.getBoundingClientRect().top <=
        window.innerHeight - space.current + END_GAP;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (list === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (visible && atEnd.current) {
        endRef.current?.scrollIntoView?.({ block: "end" });
      }
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [visible, hasMessages]);

  // Разговор может быть ещё не прочитан: до отправки берётся свежайший, с
  // первой отправки — замороженный (`useFrozenAttempt`, ADR-0035).
  const attempt = useFrozenAttempt(
    JSON.stringify([session.patientId, question.trim()]),
    conversationId,
  );

  function send() {
    const text = question.trim();
    if (!text) return;
    attempt.freeze();
    ask.mutate(
      { text, conversationId: attempt.value, idempotencyKey: attempt.key },
      {
        onSuccess: (accepted) => {
          setChosenId(accepted.conversation_id);
          setQuestion("");
          // Клавиатура закрывала ответ, который сейчас появится (Bot API 9.1).
          hideKeyboard();
        },
      },
    );
  }

  // Готовый вопрос уходит сразу, но тем же путём, что набранный: текст встаёт
  // в поле, и отправка идёт со своим ключом попытки. Сорвалась — «Спросить»
  // повторит её с тем же ключом, а не заведёт второй вопрос.
  const [starter, setStarter] = useState<string | null>(null);
  useEffect(() => {
    if (starter === null || question !== starter) return;
    setStarter(null);
    send();
    // `send` — новая функция на каждой отрисовке; запуск — по готовому тексту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starter, question]);
  function pickStarter(key: string) {
    const text = t(`assistant.starters.${key}.ask`);
    setQuestion(text);
    setStarter(text);
  }

  // «Спросить ещё раз» после недоступности — тот же вопрос НОВОЙ попыткой:
  // прежняя на сервере удалась (вопрос записан, ответа не было), и её ключ
  // вернул бы прежний отказ. Ключ один на отказ: повтор после потерянного
  // ответа не задаст вопрос дважды.
  const failed =
    last?.role === "assistant" && last.status === "failed" ? last : undefined;
  const failedQuestion = failed
    ? questionBefore(messages, failed.seq)
    : undefined;
  const retryKey = useAttemptKey(failed?.id ?? "");
  function retry() {
    if (failedQuestion === undefined || conversationId === null) return;
    ask.mutate({
      text: failedQuestion.text,
      conversationId,
      idempotencyKey: retryKey,
    });
  }

  const phoneLink = <ClinicPhone phone={phone} />;
  const rolesSummary = t(
    `assistant.audience.summary.${chatAudienceRoles(careTeam.data)}`,
  );
  const rows = withChatDays(
    messages,
    (message) => new Date(message.created_at),
    new Date(),
    {
      today: t("assistant.day.today"),
      yesterday: t("assistant.day.yesterday"),
    },
  );
  const conversationTitle = useId();

  return (
    <main className="flex flex-col gap-section p-section">
      <h1 className="text-page-title">{t("assistant.title")}</h1>

      {/* Без карточки и без видимого второго заголовка (П3): переписка — это
          и есть экран. Заголовок остаётся для программы чтения с экрана. */}
      <section aria-labelledby={conversationTitle} className="flex flex-col">
        <h2 id={conversationTitle} className="sr-only">
          {t("assistant.conversation")}
        </h2>
        <AsyncSection
          loading={
            latest.isPending ||
            (conversation.isPending && conversationId !== null)
          }
          skeleton={<ChatMessage role="assistant" pending />}
          error={
            // Не прочитался и перечень разговоров: без этой ветки экран
            // говорил «вопросов ещё не было» семье, у которой переписка есть.
            conversation.isError || latestFailed
              ? {
                  title: t("assistant.loadFailed"),
                  description: t("assistant.loadFailedHint"),
                }
              : null
          }
          waiting={
            latest.fetchStatus === "paused" ||
            conversation.fetchStatus === "paused"
              ? t("errors.waitingForNetwork")
              : null
          }
          retryLabel={t("actions.retry")}
          onRetry={() => {
            if (latestFailed) void latest.refetch();
            if (conversation.isError) void conversation.refetch();
          }}
          isEmpty={messages.length === 0}
          empty={
            <div className="flex flex-col gap-section">
              <div className="flex flex-col gap-2 text-muted-foreground">
                <p className="m-0">{t("assistant.intro")}</p>
                {/* Кто прочтёт и куда звонить о срочном — на пустом экране
                    целиком, а не только по «Кто именно» (решение Р1): тот,
                    кто пришёл с первым вопросом, раскрытие ещё не нашёл. */}
                <AudienceNote
                  readers={readers}
                  rolesSummary={rolesSummary}
                  phoneLink={phoneLink}
                />
              </div>
              <ChatStarters
                title={t("assistant.startersTitle")}
                items={STARTERS.map((key) => ({
                  key,
                  label: t(`assistant.starters.${key}.label`),
                }))}
                onPick={pickStarter}
                disabled={ask.isPending || limited}
              />
            </div>
          }
        >
          <div ref={listRef} className="flex flex-col gap-field">
            {rows.map(({ item: message, day: dayLabel }, index) => (
              <div
                key={message.id}
                ref={index === rows.length - 1 ? lastRef : undefined}
                className="flex scroll-mt-2 flex-col gap-field"
              >
                {dayLabel !== null && (
                  <ChatDayDivider>{dayLabel}</ChatDayDivider>
                )}
                <ChatMessage
                  {...(message.role === "assistant"
                    ? {
                        role: "assistant" as const,
                        note: t("assistant.disclaimer"),
                        // Заголовки статей, а не имена файлов:
                        // «how-to-plan-the-day» читается как поломка.
                        sources: (
                          <ChatSources
                            label={t("assistant.sources")}
                            articles={message.source_articles}
                            onOpen={setArticle}
                          />
                        ),
                      }
                    : { role: "user" as const })}
                  pending={message.status === "pending"}
                  pendingLabel={t("assistant.pending")}
                  // Ответа нет дольше обычного — сказать словами, а не ждать
                  // молча: при остановленном обработчике ожидание шло бы вечно.
                  slowNote={t("assistant.slow")}
                  pendingSince={new Date(message.created_at)}
                  refusal={message.role === "assistant" && isRefusal(message)}
                  nextStep={
                    <RefusalStep
                      message={message}
                      retryable={
                        message === failed && failedQuestion !== undefined
                      }
                      onRetry={retry}
                      retryDisabled={ask.isPending || limited}
                      phoneLink={phoneLink}
                    />
                  }
                >
                  {message.text}
                </ChatMessage>
              </div>
            ))}
            <div ref={endRef} aria-hidden="true" />
          </div>
        </AsyncSection>
      </section>

      {/* Поле вопроса — прижато к низу экрана над полосой вкладок, а не под
          всей перепиской: в длинном разговоре до него было не долистать. С
          открытой клавиатурой полосы нет, и поле встаёт к самому низу. */}
      <div
        ref={composerRef}
        className={cn(
          "sticky z-10 -mx-section mt-auto bg-background px-section py-2",
          keyboard.open
            ? "bottom-[var(--safe-bottom,0px)]"
            : "bottom-[calc(4rem+var(--safe-bottom,0px))]",
        )}
      >
        <h2 className="sr-only">{t("assistant.ask")}</h2>
        <ChatComposer
          value={question}
          onChange={setQuestion}
          onSubmit={send}
          onFocusChange={report}
          placeholder={t("assistant.placeholder")}
          sendLabel={t("assistant.send")}
          sendingLabel={t("assistant.sending")}
          audience={{
            summary: rolesSummary,
            detailsLabel: t("assistant.audience.more"),
            details: (
              <>
                {readers !== null && (
                  <p className="m-0">
                    {t("assistant.audience.named", { list: readers })}
                  </p>
                )}
                <p className="m-0">{t("assistant.audience.noAlerts")}</p>
                {phoneLink}
              </>
            ),
          }}
          pending={ask.isPending}
          disabled={limited}
        />
        {limited && (
          <p role="status" className="m-0 text-sm text-warning-strong">
            {t("assistant.limited")}
          </p>
        )}
        {ask.isError && !limited && (
          <p role="alert" className="m-0 text-sm text-destructive">
            {errorMessageOf(ask.error) ?? t("assistant.sendFailed")}
          </p>
        )}
      </div>

      <ArticleSheet article={article} onClose={() => setArticle(null)} />
    </main>
  );
}

/** The family's question the answer under `seq` replied to. */
function questionBefore(
  messages: readonly AssistantMessage[],
  seq: number,
): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === "user" && message.seq < seq) {
      return message;
    }
  }
  return undefined;
}

/**
 * Кто прочтёт вопрос и что делать о срочном — для пустого экрана (Р1).
 *
 * Имена, когда они известны, иначе роли: молчать о том, что вопрос прочтут,
 * нельзя ни в одном состоянии.
 */
function AudienceNote({
  readers,
  rolesSummary,
  phoneLink,
}: {
  readers: string | null;
  rolesSummary: string;
  phoneLink: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <p className="m-0">
        {readers === null
          ? rolesSummary
          : t("assistant.audience.readBy", { list: readers })}
      </p>
      <p className="m-0">{t("assistant.audience.noAlerts")}</p>
      {phoneLink}
    </>
  );
}

/**
 * Что делать после отказа (П4), по правилу кита `refusalNextStep`. Помощник
 * недоступен — «Спросить ещё раз» у последнего такого отказа. Вопрос отклонён
 * — к врачу на приёме и телефон клиники, если он задан. Исчерпан предел —
 * ничего: текст сам говорит «завтра», а врач на вопросы о приложении не
 * отвечает.
 */
function RefusalStep({
  message,
  retryable,
  onRetry,
  retryDisabled,
  phoneLink,
}: {
  message: AssistantMessage;
  retryable: boolean;
  onRetry: () => void;
  retryDisabled: boolean;
  phoneLink: ReactNode;
}) {
  const { t } = useTranslation();
  const step = refusalNextStep(message);
  if (step === null || step === "none") return null;
  if (step === "retry") {
    if (!retryable) return null;
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-touch self-start"
        disabled={retryDisabled}
        onClick={onRetry}
      >
        <RotateCcw aria-hidden="true" />
        {t("assistant.retry")}
      </Button>
    );
  }
  return (
    <>
      <p className="m-0">{t("assistant.askDoctor")}</p>
      {phoneLink}
    </>
  );
}

/**
 * Статья, на которую опирается ответ, — панелью поверх переписки. «Назад»
 * Telegram закрывает её, как любое вложенное состояние.
 */
function ArticleSheet({
  article,
  onClose,
}: {
  article: ChatSourceArticle | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useArticle(article?.slug ?? null);
  useTelegramBack(article === null ? null : onClose);

  return (
    <FormSheet
      open={article !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={query.data?.title ?? article?.title ?? ""}
      closeLabel={t("assistant.article.close")}
      // Панель рисуется вне полей страницы: во весь экран Telegram шапка и
      // полоса «домой» закрыли бы её заголовок, крестик и последние строки.
      className="pt-(--safe-top,0px) pb-(--safe-bottom,0px)"
    >
      {errorCodeOf(query.error) === "not_found" ? (
        // The article left the knowledge base after the answer was given:
        // «check the connection» and «Повторить» would send the parent after
        // a network that works and a retry that never helps.
        <p role="status" className="m-0">
          {t("assistant.article.gone")}
        </p>
      ) : (
        <AsyncSection
          loading={query.isPending}
          skeleton={
            <div
              role="status"
              aria-label={t("assistant.article.loading")}
              className="flex flex-col gap-2"
            >
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          }
          error={
            query.isError
              ? {
                  title: t("assistant.article.loadFailed"),
                  description: t("assistant.article.loadFailedHint"),
                }
              : null
          }
          waiting={
            query.fetchStatus === "paused"
              ? t("errors.waitingForNetwork")
              : null
          }
          retryLabel={t("actions.retry")}
          onRetry={() => void query.refetch()}
          isEmpty={query.data === undefined}
          empty={null}
        >
          {query.data !== undefined && <ChatText text={query.data.body_md} />}
        </AsyncSection>
      )}
    </FormSheet>
  );
}

/** Текущее время, обновляемое раз в 15 секунд, пока `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [ticking]);
  return now;
}
