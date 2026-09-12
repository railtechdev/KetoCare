import {
  AsyncSection,
  ChatComposer,
  ChatMessage,
  Section,
  useAttemptKey,
} from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import {
  useAskAssistant,
  useConversation,
  useLatestConversationId,
} from "./useAssistant";

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
 *
 * Экран открывается на последней переписке семьи. До этого идентификатор жил
 * только в состоянии компонента: родитель спрашивал, получал ответ, уходил в
 * другой раздел — и, вернувшись, видел пустой чат. Разговор при этом лежал на
 * сервере и был доступен лечащему врачу, то есть семья единственная не могла
 * перечитать собственную переписку.
 */
export function AssistantPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("assistant");
  // `null` — «ещё не знаем»: до ответа сервера о последней переписке экран не
  // должен решать, что её нет. Отсюда же и `undefined` у выбранной вручную:
  // выбор человека сильнее подставленного умолчания.
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const [question, setQuestion] = useState("");

  const latest = useLatestConversationId(patientId);
  const conversationId = chosenId ?? latest.data ?? null;

  const conversation = useConversation(patientId, conversationId);
  const ask = useAskAssistant(patientId);

  const messages = conversation.data ?? [];
  const limited = errorCodeOf(ask.error) === "rate_limited";

  // Пока вопрос и разговор те же, попытка та же: повтор после потерянного
  // ответа не заведёт второй вопрос в переписке (ADR-0035).
  const attemptKey = useAttemptKey(
    JSON.stringify([patientId, conversationId, question.trim()]),
  );

  function send() {
    const text = question.trim();
    if (!text) return;
    ask.mutate(
      { text, conversationId, idempotencyKey: attemptKey },
      {
        onSuccess: (accepted) => {
          setChosenId(accepted.conversation_id);
          setQuestion("");
        },
      },
    );
  }

  return (
    <PageLayout title={t("title")} intro={t("intro")} width="form">
      <Section title={t("conversation")} density="compact">
        <AsyncSection
          // Пока идёт запрос о последней переписке, экран тоже занят: иначе
          // между ответами мелькает «переписки пока нет» — и родитель успевает
          // прочесть, что его разговора не существует.
          loading={
            latest.isPending ||
            (conversation.isPending && conversationId !== null)
          }
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
