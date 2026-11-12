import {
  AsyncSection,
  ChatComposer,
  ChatMessage,
  chatReadersList,
  isRefusal,
  Section,
  useFrozenAttempt,
} from "@ketocare/ui";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { currentLanguage } from "../../lib/i18n";
import { hideKeyboard } from "../../lib/telegram";
import { TabVisibleContext, useUnsavedGuard } from "../../lib/useTelegram";
import { today } from "../menu/useMenu";
import type { Session } from "../session/useSession";
import {
  useAskAssistant,
  useCareTeam,
  useConversation,
  useLatestConversationId,
} from "./useAssistant";

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
 */
export function AssistantScreen({ session }: { session: Session }) {
  const { t } = useTranslation();
  // Выбор человека сильнее подставленного умолчания; `null` — «ещё не знаем».
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const latest = useLatestConversationId(session.patientId);
  const conversationId = chosenId ?? latest.data ?? null;
  const [question, setQuestion] = useState("");

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

  const messages = conversation.data ?? [];
  // Свежайший разговор не прочитан, а свой разговор человек не выбирал —
  // показывать «пусто» значит утверждать то, чего мы не знаем.
  const latestFailed = latest.isError && chosenId === undefined;
  // Недописанный вопрос: Telegram спросит, прежде чем закрыться.
  useUnsavedGuard(question.trim() !== "");
  const limited = errorCodeOf(ask.error) === "rate_limited";

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

  // К последнему сообщению — когда приходит новое и когда вкладку открывают:
  // ответ появлялся под всей перепиской, ниже первого экрана.
  const visible = useContext(TabVisibleContext);
  const endRef = useRef<HTMLDivElement>(null);
  const lastKey = `${messages.length}:${messages.at(-1)?.status ?? ""}`;
  useEffect(() => {
    if (!visible) return;
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [lastKey, visible]);

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

  return (
    <main className="flex flex-col gap-section p-section">
      <h1 className="text-page-title">{t("assistant.title")}</h1>

      <Section title={t("assistant.conversation")} density="compact">
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
            <p className="text-muted-foreground">{t("assistant.empty")}</p>
          }
        >
          <div className="flex flex-col gap-field">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                {...(message.role === "assistant"
                  ? {
                      role: "assistant" as const,
                      note: (
                        <>
                          {t("assistant.disclaimer")}
                          {/* Заголовки статей, а не имена файлов:
                              «how-to-plan-the-day» читается как поломка. */}
                          {message.source_articles.length > 0 && (
                            <>
                              {" "}
                              {t("assistant.sources", {
                                list: message.source_articles
                                  .map((article) => article.title)
                                  .join(", "),
                              })}
                            </>
                          )}
                        </>
                      ),
                    }
                  : { role: "user" as const })}
                pending={message.status === "pending"}
                // Ответа нет дольше обычного — сказать словами, а не ждать
                // молча: при остановленном обработчике ожидание шло бы вечно.
                slowNote={t("assistant.slow")}
                pendingSince={new Date(message.created_at)}
                refusal={isRefusal(message)}
              >
                {message.text}
              </ChatMessage>
            ))}
            <div ref={endRef} />
          </div>
        </AsyncSection>
      </Section>

      {/* Поле вопроса — прижато к низу экрана над полосой вкладок, а не под
          всей перепиской: в длинном разговоре до него было не долистать. */}
      <div className="sticky bottom-[calc(4rem+var(--safe-bottom,0px))] z-10 -mx-section bg-background px-section pt-field pb-field">
        <Section title={t("assistant.ask")} titleHidden density="compact">
          <ChatComposer
            value={question}
            onChange={setQuestion}
            onSubmit={send}
            placeholder={t("assistant.placeholder")}
            sendLabel={t("assistant.send")}
            sendingLabel={t("assistant.sending")}
            hint={t("assistant.hint")}
            audience={
              readers === null
                ? t("assistant.audience.roles")
                : t("assistant.audience.named", { list: readers })
            }
            pending={ask.isPending}
            disabled={limited}
          />
          {limited && (
            <p role="status" className="text-warning-strong">
              {errorMessageOf(ask.error) ?? t("assistant.limited")}
            </p>
          )}
          {ask.isError && !limited && (
            <p role="alert" className="text-destructive">
              {errorMessageOf(ask.error) ?? t("assistant.sendFailed")}
            </p>
          )}
        </Section>
      </div>
    </main>
  );
}
