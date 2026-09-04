import { AsyncSection, ChatComposer, ChatMessage, Section } from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { useAskAssistant, useConversation } from "./useAssistant";

/**
 * Помощник семьи (раздел 10.4 ТЗ, п. 20 этапа 4).
 *
 * Отвечает только по материалам приложения; на вопросы о ребёнке — шаблоном со
 * ссылкой на врача. Это не ограничение реализации, а граница ответственности:
 * утверждённых медицинской командой материалов в базе пока нет, и любой другой
 * ответ был бы измышлением о ребёнке на терапии (ADR-0021).
 *
 * Ответ приходит не сразу: ручка принимает вопрос и кладёт в переписку
 * «ожидание», а воркер заменяет его ответом (ADR-0022). Поэтому экран
 * дочитывает переписку, а не ждёт ответа запросом.
 */
export function AssistantPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("assistant");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  const conversation = useConversation(patientId, conversationId);
  const ask = useAskAssistant(patientId);

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
    <PageLayout title={t("title")} intro={t("intro")} width="form">
      <Section title={t("conversation")} density="compact">
        <AsyncSection
          loading={conversation.isPending && conversationId !== null}
          skeleton={<ChatMessage role="assistant" pending />}
          error={
            conversation.isError
              ? { title: t("loadFailed"), description: t("loadFailedHint") }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void conversation.refetch()}
          isEmpty={messages.length === 0}
          empty={<p className="text-muted-foreground">{t("empty")}</p>}
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
                      {t("disclaimer")}
                      {message.sources.length > 0 && (
                        <>
                          {" "}
                          {t("sources", { list: message.sources.join(", ") })}
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

      <Section title={t("ask")} density="compact">
        <ChatComposer
          value={question}
          onChange={setQuestion}
          onSubmit={send}
          placeholder={t("placeholder")}
          sendLabel={t("send")}
          sendingLabel={t("sending")}
          hint={t("hint")}
          pending={ask.isPending}
          disabled={limited}
        />
        {limited && (
          <p className="m-0 text-sm text-warning">
            {errorMessageOf(ask.error) ?? t("limited")}
          </p>
        )}
        {ask.isError && !limited && (
          <p className="m-0 text-sm text-destructive">
            {errorMessageOf(ask.error) ?? t("sendFailed")}
          </p>
        )}
      </Section>
    </PageLayout>
  );
}
