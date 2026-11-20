import { mergeBySeq, nextAfterSeq } from "@ketocare/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";

export interface AssistantMessage {
  seq: number;
  id: string;
  role: "user" | "assistant";
  text: string;
  created_at: string;
  status: "pending" | "done" | "failed";
  sources: string[];
  /** Статьи с заголовками — их и печатает экран под ответом. */
  source_articles: { slug: string; title: string }[];
  blocked: boolean;
  /** Отказ — исчерпанный предел: под ним нет «спросите врача». */
  limited: boolean;
}

/**
 * Как часто дочитывается переписка, пока ответ не пришёл.
 *
 * Ответ помощника идёт секундами, а `/ai/*` ограничен шестьюдесятью запросами
 * в минуту: опрос чаще упрётся в собственный лимит, и «помощник думает»
 * превратится в «слишком много запросов».
 */
const POLL_MS = 2500;

/**
 * Последняя переписка семьи с помощником.
 *
 * Нужна, чтобы экран открывался НА НЕЙ, а не с чистого листа. До этого
 * идентификатор переписки жил только в состоянии экрана: родитель задавал
 * вопрос, получал ответ, уходил в другой раздел — и, вернувшись, видел пустой
 * чат. Переписка при этом никуда не девалась: она лежит на сервере, и её
 * читает лечащий врач (ADR-0022). То есть семья единственная не могла
 * перечитать собственный разговор.
 *
 * Берём одну, самую свежую: сервер отдаёт список от новых к старым, а
 * переписка у семьи по смыслу одна — продолжающийся разговор, а не переписка с
 * разными собеседниками.
 */
export function useLatestConversationId(patientId: string) {
  return useQuery({
    queryKey: ["assistant", patientId, "latest"],
    // Список нужен один раз при открытии экрана: дальше идентификатор известен,
    // и перечитывать перечень на каждом фокусе окна незачем.
    staleTime: Infinity,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/ai-conversations",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: 1, offset: 0 },
          },
        },
      );
      if (error) throw error;
      return data?.items?.[0]?.id ?? null;
    },
  });
}

export function useConversation(
  patientId: string,
  conversationId: string | null,
  options: { reader?: boolean } = {},
) {
  // Специалист читает чужую переписку, и каждое чтение пишется в журнал
  // аудита. Опрос и перечитывание при возврате на вкладку плодили бы записи
  // без конца, пока ответ не дописан (находка ревью, 05.10.2026), поэтому
  // читателю переписка не обновляется сама — только по кнопке.
  const reader = options.reader === true;
  const queryClient = useQueryClient();
  const queryKey = ["assistant", patientId, conversationId];
  return useQuery({
    queryKey,
    enabled: conversationId !== null,
    refetchOnWindowFocus: !reader,
    // Пока ответ не дописан, переписка перечитывается; как только дописан —
    // опрос прекращается сам.
    refetchInterval: (query) => {
      if (reader) return false;
      const messages = (query.state.data ?? []) as AssistantMessage[];
      return messages.some((message) => message.status === "pending")
        ? POLL_MS
        : false;
    },
    queryFn: async (): Promise<AssistantMessage[]> => {
      // Семья дочитывает только новое (`nextAfterSeq` кита, П8 аудита Mini
      // App): опрос перекачивал всю переписку каждые 2,5 секунды. Читатель
      // (специалист) перечитывает целиком — он обновляет переписку только по
      // кнопке, и каждое чтение у него — запись в журнале.
      const cached = reader
        ? undefined
        : queryClient.getQueryData<AssistantMessage[]>(queryKey);
      const afterSeq = nextAfterSeq(cached);
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/ai-conversations/{conversation_id}",
        {
          params: {
            path: {
              patient_id: patientId,
              conversation_id: conversationId ?? "",
            },
            ...(afterSeq === undefined
              ? {}
              : { query: { after_seq: afterSeq } }),
          },
        },
      );
      if (error || !data)
        throw error ?? new Error("Empty conversation response");
      const fresh = data.messages as AssistantMessage[];
      return afterSeq === undefined ? fresh : mergeBySeq(cached, fresh);
    },
  });
}

export function useAskAssistant(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      text: string;
      conversationId: string | null;
      // Ключ попытки (ADR-0035): потерянный ответ 202 иначе даёт второй вопрос
      // в переписке, вторую задачу воркера и второй расход бюджета.
      idempotencyKey: string;
    }) => {
      const { data, error } = await api.POST("/api/v1/ai/assistant/messages", {
        params: { header: { "Idempotency-Key": input.idempotencyKey } },
        body: {
          patient_id: patientId,
          conversation_id: input.conversationId,
          text: input.text,
        },
      });
      if (error || !data) throw error ?? new Error("Empty assistant response");
      return data;
    },
    onSuccess: (accepted) => {
      // Переписка перечитывается сразу: вопрос и «ожидание» уже лежат в ней,
      // и экран не должен ждать первого тика опроса, чтобы их показать.
      void queryClient.invalidateQueries({
        queryKey: ["assistant", patientId, accepted.conversation_id],
      });
    },
  });
}

/**
 * Статья базы знаний, на которую опирается ответ: заголовок под ответом
 * открывает её панелью. Статьи меняются выкатом — час без перечитывания.
 */
export function useArticle(slug: string | null) {
  return useQuery({
    queryKey: ["kb-article", slug],
    enabled: slug !== null,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/knowledge-base/articles/{slug}",
        { params: { path: { slug: slug ?? "" } } },
      );
      if (error || !data) throw error ?? new Error("Empty article response");
      return data;
    },
  });
}
