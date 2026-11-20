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
  Section,
  Skeleton,
  chatAudienceRoles,
  chatReadersList,
  isRefusal,
  refusalNextStep,
  telHref,
  useAttemptKey,
  useFrozenAttempt,
  withChatDays,
  type ChatSourceArticle,
} from "@ketocare/ui";
import { RotateCcw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { PageLayout } from "../../components/PageLayout";
import { errorCodeOf, errorMessageOf } from "../../lib/api";
import { queryState } from "../../lib/queryState";
import { useCareTeam } from "../doctor/doctorQueries";
import { useLetterhead } from "../letterhead/useLetterhead";
import {
  type AssistantMessage,
  useArticle,
  useAskAssistant,
  useConversation,
  useLatestConversationId,
} from "./useAssistant";

/** Готовые вопросы на пустом экране — те же, что в Mini App (решение Р5). */
const STARTERS = [
  "seizure",
  "menu",
  "fixEntry",
  "invite",
  "reminders",
  "dishMismatch",
] as const;

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
 *
 * Части переписки — те же, что в Mini App (аудит Mini App 2026-11): готовые
 * вопросы, отказ своим видом со следующим шагом, источник — ссылкой на статью,
 * подписи дней.
 */
export function AssistantPage({ patientId }: { patientId: string }) {
  const { t } = useTranslation("assistant");
  // `null` — «ещё не знаем»: до ответа сервера о последней переписке экран не
  // должен решать, что её нет. Отсюда же и `undefined` у выбранной вручную:
  // выбор человека сильнее подставленного умолчания.
  const [chosenId, setChosenId] = useState<string | undefined>(undefined);
  const [question, setQuestion] = useState("");
  const [article, setArticle] = useState<ChatSourceArticle | null>(null);

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
  const letterhead = useLetterhead();
  const phone = letterhead.data?.text?.family_phone?.trim() || null;

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

  // Готовый вопрос уходит сразу, но тем же путём, что набранный: текст встаёт
  // в поле и отправляется со своим ключом попытки — сорвалась отправка,
  // «Спросить» повторит её тем же ключом.
  const [starter, setStarter] = useState<string | null>(null);
  useEffect(() => {
    if (starter === null || question !== starter) return;
    setStarter(null);
    send();
    // `send` — новая функция на каждой отрисовке; запуск — по готовому тексту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starter, question]);
  function pickStarter(key: string) {
    const text = t(`starters.${key}`);
    setQuestion(text);
    setStarter(text);
  }

  // «Спросить ещё раз» после недоступности — тот же вопрос новой попыткой:
  // прежняя на сервере удалась, и её ключ вернул бы прежний отказ.
  const last = messages.at(-1);
  const failed =
    last?.role === "assistant" && last.status === "failed" ? last : undefined;
  const failedQuestion =
    failed === undefined ? undefined : questionBefore(messages, failed.seq);
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
    `audience.summary.${chatAudienceRoles(careTeam.data)}`,
  );
  const rows = withChatDays(
    messages,
    (message) => new Date(message.created_at),
    new Date(),
    { today: t("day.today"), yesterday: t("day.yesterday") },
  );

  return (
    <PageLayout title={t("title")} intro={t("intro")} width="form">
      <Section title={t("conversation")}>
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
          empty={
            <div className="flex flex-col gap-section">
              <div className="flex flex-col gap-2 text-muted-foreground">
                <p className="m-0">{t("empty")}</p>
                {/* Кто прочтёт и куда звонить о срочном — на пустом экране
                    целиком, а не только по «Кто именно» (решение Р1): семья
                    с первым вопросом раскрытие ещё не нашла. */}
                <p className="m-0">
                  {readers === null
                    ? rolesSummary
                    : t("audience.readBy", { list: readers })}
                </p>
                <p className="m-0">{t("audience.noAlerts")}</p>
                {phoneLink}
              </div>
              <ChatStarters
                title={t("startersTitle")}
                items={STARTERS.map((key) => ({
                  key,
                  label: t(`starters.${key}`),
                }))}
                onPick={pickStarter}
                disabled={ask.isPending || limited}
              />
            </div>
          }
        >
          <div className="flex flex-col gap-field">
            {rows.map(({ item: message, day }) => (
              <div key={message.id} className="flex flex-col gap-field">
                {day !== null && <ChatDayDivider>{day}</ChatDayDivider>}
                <ChatMessage
                  {...(message.role === "assistant"
                    ? {
                        role: "assistant" as const,
                        note: t("disclaimer"),
                        // Заголовки статей, а не имена файлов:
                        // «how-to-plan-the-day» читается как поломка.
                        sources: (
                          <ChatSources
                            label={t("sources")}
                            articles={message.source_articles}
                            onOpen={setArticle}
                          />
                        ),
                      }
                    : { role: "user" as const })}
                  pending={message.status === "pending"}
                  pendingLabel={t("pending")}
                  // Ответа нет дольше обычного — сказать словами, а не ждать
                  // молча: при остановленном обработчике ожидание шло бы вечно.
                  slowNote={t("slow")}
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
          </div>
        </AsyncSection>
      </Section>

      <Section title={t("ask")}>
        <ChatComposer
          value={question}
          onChange={setQuestion}
          onSubmit={send}
          placeholder={t("placeholder")}
          sendLabel={t("send")}
          sendingLabel={t("sending")}
          audience={{
            summary: rolesSummary,
            detailsLabel: t("audience.more"),
            details: (
              <>
                {readers !== null && (
                  <p className="m-0">
                    {t("audience.named", { list: readers })}
                  </p>
                )}
                <p className="m-0">{t("audience.noAlerts")}</p>
                {phoneLink}
              </>
            ),
          }}
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

      <ArticleSheet article={article} onClose={() => setArticle(null)} />
    </PageLayout>
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
 * «Телефон клиники: +998 …» — ссылкой для звонка; без номера — ничего.
 *
 * Ссылка — блок высотой в касание: строчная была высотой в строку, и
 * `min-height` базовой темы на строчный элемент не действует (правило П20).
 */
function ClinicPhone({ phone }: { phone: string | null }) {
  const { t } = useTranslation("assistant");
  const href = telHref(phone);
  if (phone === null || href === null) return null;
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-1">
      {t("clinicPhone")}
      <a
        href={href}
        className="inline-flex min-h-touch items-center font-medium whitespace-nowrap text-primary underline underline-offset-2"
      >
        {phone}
      </a>
    </p>
  );
}

/**
 * Что делать после отказа, по правилу кита `refusalNextStep`. Помощник
 * недоступен — «Спросить ещё раз» у последнего такого отказа. Вопрос отклонён
 * — к врачу на приёме и телефон клиники, если он задан в бланке. Исчерпан
 * предел — ничего: текст сам говорит «завтра», а врач на вопросы о
 * приложении не отвечает.
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
  const { t } = useTranslation("assistant");
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
        {t("retry")}
      </Button>
    );
  }
  return (
    <>
      <p className="m-0">{t("askDoctor")}</p>
      {phoneLink}
    </>
  );
}

/** Статья, на которую опирается ответ, — панелью, не уводя с переписки. */
function ArticleSheet({
  article,
  onClose,
}: {
  article: ChatSourceArticle | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("assistant");
  const query = useArticle(article?.slug ?? null);

  return (
    <FormSheet
      open={article !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={query.data?.title ?? article?.title ?? ""}
      closeLabel={t("common:actions.close")}
    >
      {errorCodeOf(query.error) === "not_found" ? (
        // The article left the knowledge base after the answer was given:
        // «check the connection» and «Повторить» would never help.
        <p role="status" className="m-0">
          {t("article.gone")}
        </p>
      ) : (
        <AsyncSection
          {...queryState(query)}
          skeleton={
            <div
              role="status"
              aria-label={t("article.loading")}
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
                  title: t("article.loadFailed"),
                  description: t("article.loadFailedHint"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
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
