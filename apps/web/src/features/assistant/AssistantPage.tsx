import {
  AsyncSection,
  ChatComposer,
  ChatMessage,
  chatReadersList,
  isRefusal,
  Section,
  useFrozenAttempt,
} from "@ketocare/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import { useCareTeam } from "../doctor/doctorQueries";
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
  // Те же люди, кого сервер пускает к переписке (ADR-0022). Пока имена не
  // пришли или не пришли вовсе, строка говорит о ролях — молчать о том, что
  // вопрос прочтут, нельзя ни в одном состоянии.
  const careTeam = useCareTeam(patientId);
  const readers = chatReadersList(
    careTeam.data,
    (role) => t(`audience.role.${role}`, { defaultValue: role }),
    "ru",
  );

  const messages = conversation.data ?? [];
  const limited = errorCodeOf(ask.error) === "rate_limited";

  // Разговор может быть ещё не прочитан: до отправки берётся свежайший, с
  // первой отправки — замороженный (`useFrozenAttempt`, ADR-0035).
  const attempt = useFrozenAttempt(
    JSON.stringify([patientId, question.trim()]),
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
          //
          // Отказ в последней переписке — тоже ошибка с повтором, а не
          // «переписки пока нет»: разговор на сервере есть, просто не дошёл.
          {...queryState(latest, conversation)}
          skeleton={<ChatMessage role="assistant" pending />}
          error={
            latest.isError || conversation.isError
              ? { title: t("loadFailed"), description: t("loadFailedHint") }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => {
            if (latest.isError) void latest.refetch();
            if (conversation.isError) void conversation.refetch();
          }}
          isEmpty={messages.length === 0}
          empty={<p className="text-muted-foreground">{t("empty")}</p>}
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
                          {t("disclaimer")}
                          {/* Заголовки статей, а не имена файлов:
                              «how-to-plan-the-day» читается как поломка. */}
                          {message.source_articles.length > 0 && (
                            <>
                              {" "}
                              {t("sources", {
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
                slowNote={t("slow")}
                pendingSince={new Date(message.created_at)}
                refusal={isRefusal(message)}
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
          audience={
            readers === null
              ? t("audience.roles")
              : t("audience.named", { list: readers })
          }
          pending={ask.isPending}
          disabled={limited}
        />
        {limited && (
          <p className="m-0 text-sm text-warning-strong">
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
