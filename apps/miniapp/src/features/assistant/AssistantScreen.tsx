import { AsyncSection, ChatComposer, ChatMessage, Section } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorCodeOf, errorMessageOf } from "../../lib/api";
import type { Session } from "../session/useSession";
import { useAskAssistant, useConversation } from "./useAssistant";

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
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  const conversation = useConversation(session.patientId, conversationId);
  const ask = useAskAssistant(session.patientId);

  const messages = conversation.data ?? [];
  const limited = errorCodeOf(ask.error) === "rate_limited";

  function send() {
    const text = question.trim();
    if (!text) return;
    ask.mutate(
      { text, conversationId },
      {
        onSuccess: (accepted) => {
          setConversationId(accepted.conversation_id);
          setQuestion("");
        },
      },
    );
  }

  return (
    <main className="flex flex-col gap-block p-block">
      <h1 className="text-page-title">{t("assistant.title")}</h1>

      <Section title={t("assistant.conversation")} density="compact">
        <AsyncSection
          loading={conversation.isPending && conversationId !== null}
          skeleton={<ChatMessage role="assistant" pending />}
          error={
            conversation.isError
              ? {
                  title: t("assistant.loadFailed"),
                  description: t("assistant.loadFailedHint"),
                }
              : null
          }
          retryLabel={t("actions.retry")}
          onRetry={() => void conversation.refetch()}
          isEmpty={messages.length === 0}
          empty={
            <p className="text-muted-foreground">{t("assistant.empty")}</p>
          }
        >
          <div className="flex flex-col gap-field">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                pending={message.status === "pending"}
                note={
                  message.role === "assistant" ? (
                    <>
                      {t("assistant.disclaimer")}
                      {message.sources.length > 0 && (
                        <>
                          {" "}
                          {t("assistant.sources", {
                            list: message.sources.join(", "),
                          })}
                        </>
                      )}
                    </>
                  ) : undefined
                }
              >
                {message.text}
              </ChatMessage>
            ))}
          </div>
        </AsyncSection>
      </Section>

      <Section title={t("assistant.ask")} density="compact">
        <ChatComposer
          value={question}
          onChange={setQuestion}
          onSubmit={send}
          placeholder={t("assistant.placeholder")}
          sendLabel={t("assistant.send")}
          sendingLabel={t("assistant.sending")}
          hint={t("assistant.hint")}
          pending={ask.isPending}
          disabled={limited}
        />
        {limited && (
          <p className="text-warning">
            {errorMessageOf(ask.error) ?? t("assistant.limited")}
          </p>
        )}
        {ask.isError && !limited && (
          <p className="text-destructive">
            {errorMessageOf(ask.error) ?? t("assistant.sendFailed")}
          </p>
        )}
      </Section>
    </main>
  );
}
