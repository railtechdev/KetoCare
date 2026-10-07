import {
  AsyncSection,
  Button,
  ChatMessage,
  EmptyState,
  Section,
  cn,
  isRefusal,
} from "@ketocare/ui";
import { ArrowLeft, MessageCircleQuestion, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { errorMessageOf } from "../../lib/api";
import { useSectionItem } from "../../routes/useSectionTab";
import { useConversation } from "../assistant/useAssistant";
import { formatTimestamp } from "./dates";
import {
  FAMILY_QUESTIONS_PAGE,
  useFamilyConversations,
  type FamilyConversation,
} from "./familyQuestions";
import { LinesSkeleton } from "./skeletons";
import { queryState } from "../../lib/queryState";
import { PatientViewLink } from "./PatientViewLink";

/**
 * «Вопросы семьи» — переписка семьи с помощником, на чтение (ADR-0022).
 *
 * Семье под полем вопроса сказано, что переписку видит лечащий врач; до этого
 * раздела API её специалисту отдавал, а экрана не было, и вопрос, оставшийся
 * без ответа помощника, не доходил ни до кого (AUDIT_BLOCKERS, C4).
 *
 * Главное здесь — отказы. Помощник отвечает только по материалам приложения,
 * и на вопрос о ребёнке, на вопрос без подходящей статьи или при исчерпанном
 * пределе семья получает шаблон. Такие разговоры подсвечены: это вопросы,
 * которые ждут человека. Правило «что считать отказом» одно — `isRefusal` кита
 * и `refused_count` сервера считают одно и то же.
 *
 * Поля ввода нет намеренно: спрашивает только семья (ADR-0022), специалист
 * отвечает ей сам — на приёме, по телефону, в заметке. Открытый разговор живёт
 * в адресе (`?item=`): F5 и «Назад» возвращают туда же, где был врач. Каждое
 * открытие сервер пишет в журнал аудита — экран для этого ничего не делает.
 */
export function FamilyQuestionsView({ patientId }: { patientId: string }) {
  const [openId, setOpenId] = useSectionItem();

  if (openId !== undefined) {
    return (
      <ConversationReader
        patientId={patientId}
        conversationId={openId}
        onBack={() => setOpenId(undefined)}
      />
    );
  }

  return <ConversationList patientId={patientId} onOpen={setOpenId} />;
}

function ConversationList({
  patientId,
  onOpen,
}: {
  patientId: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation("doctor");
  const [limit, setLimit] = useState(FAMILY_QUESTIONS_PAGE);
  const conversations = useFamilyConversations(patientId, limit);

  const items = conversations.data?.items ?? [];
  const total = conversations.data?.total ?? 0;
  const refused = items.filter((item) => item.refused_count > 0).length;

  return (
    <Section
      title={t("questions.listTitle")}
      description={
        refused > 0
          ? t("questions.refusedSummary", { count: refused })
          : t("questions.description")
      }
      density="compact"
      // «Вопросы ждут вас» без выхода — тупик: отвечать семье здесь нельзя
      // (переписка только на чтение), а контакты семьи — в разделе «Профиль».
      action={
        refused > 0 ? (
          <Button asChild variant="outline">
            <PatientViewLink patientId={patientId} view="profile">
              {t("questions.contacts")}
            </PatientViewLink>
          </Button>
        ) : undefined
      }
    >
      <AsyncSection
        {...queryState(conversations)}
        skeleton={<LinesSkeleton label={t("questions.loading")} lines={4} />}
        error={
          conversations.isError
            ? {
                title: t("questions.loadError"),
                description:
                  errorMessageOf(conversations.error) ??
                  t("common:errors.unexpected"),
              }
            : null
        }
        retryLabel={t("common:actions.retry")}
        onRetry={() => void conversations.refetch()}
        isEmpty={items.length === 0}
        empty={
          <EmptyState
            icon={MessageCircleQuestion}
            title={t("questions.empty")}
            description={t("questions.emptyDescription")}
          />
        }
      >
        <ul className="m-0 flex list-none flex-col gap-field p-0">
          {items.map((item) => (
            <li key={item.id}>
              <ConversationRow item={item} onOpen={() => onOpen(item.id)} />
            </li>
          ))}
        </ul>
        {items.length < total && (
          <Button
            type="button"
            variant="outline"
            className="min-h-touch self-start"
            disabled={conversations.isFetching}
            onClick={() =>
              setLimit((current) => current + FAMILY_QUESTIONS_PAGE)
            }
          >
            {t("questions.more", { shown: items.length, total })}
          </Button>
        )}
      </AsyncSection>
    </Section>
  );
}

function ConversationRow({
  item,
  onOpen,
}: {
  item: FamilyConversation;
  onOpen: () => void;
}) {
  const { t } = useTranslation("doctor");
  const refused = item.refused_count > 0;
  const updated = formatTimestamp(item.updated_at) ?? item.updated_at;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-refused={refused || undefined}
      className={cn(
        "flex min-h-touch w-full flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
        refused && "border-l-4 border-l-warning",
      )}
    >
      <span className="text-sm font-medium">
        {item.preview === "" ? t("questions.noPreview") : item.preview}
      </span>
      <span className="text-xs text-muted-foreground">
        {t("questions.meta", { at: updated, count: item.messages_count })}
      </span>
      {refused && (
        <span className="flex items-center gap-1 text-xs text-warning-strong">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {t("questions.refused", { count: item.refused_count })}
        </span>
      )}
    </button>
  );
}

function ConversationReader({
  patientId,
  conversationId,
  onBack,
}: {
  patientId: string;
  conversationId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("doctor");
  const conversation = useConversation(patientId, conversationId, {
    reader: true,
  });
  const messages = conversation.data ?? [];
  const started = messages[0]?.created_at;

  return (
    <div className="flex flex-col gap-section">
      <Button
        type="button"
        variant="ghost"
        className="min-h-touch self-start"
        onClick={onBack}
      >
        <ArrowLeft aria-hidden="true" />
        {t("questions.back")}
      </Button>
      <Section
        title={
          started
            ? t("questions.conversationFrom", {
                at: formatTimestamp(started) ?? started,
              })
            : t("questions.conversation")
        }
        description={t("questions.readOnly")}
        density="compact"
      >
        <AsyncSection
          {...queryState(conversation)}
          skeleton={<ChatMessage role="assistant" pending />}
          error={
            conversation.isError
              ? {
                  title: t("questions.openError"),
                  description:
                    errorMessageOf(conversation.error) ??
                    t("common:errors.unexpected"),
                }
              : null
          }
          retryLabel={t("common:actions.retry")}
          onRetry={() => void conversation.refetch()}
          isEmpty={messages.length === 0}
          empty={
            <p className="m-0 text-muted-foreground">
              {t("questions.noMessages")}
            </p>
          }
        >
          <div className="flex flex-col gap-field">
            {messages.map((message) => {
              const refusal =
                message.role === "assistant" && isRefusal(message);
              return (
                <div key={message.id} className="flex flex-col gap-1">
                  <ChatMessage
                    {...(message.role === "assistant"
                      ? {
                          role: "assistant" as const,
                          note: t("assistant:disclaimer"),
                        }
                      : { role: "user" as const })}
                    pending={message.status === "pending"}
                    refusal={refusal}
                    meta={
                      <>
                        {message.role === "user"
                          ? t("questions.family")
                          : t("questions.assistant")}
                        {", "}
                        {formatTimestamp(message.created_at) ??
                          message.created_at}
                      </>
                    }
                  >
                    {message.text}
                  </ChatMessage>
                  {refusal && (
                    <p className="m-0 flex items-center gap-1 text-xs text-warning-strong">
                      <TriangleAlert aria-hidden="true" className="size-3.5" />
                      {t("questions.refusalNote")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </AsyncSection>
      </Section>
    </div>
  );
}
