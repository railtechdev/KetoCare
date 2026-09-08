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
  blocked: boolean;
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
) {
  return useQuery({
    queryKey: ["assistant", patientId, conversationId],
    enabled: conversationId !== null,
    // Пока ответ не дописан, переписка перечитывается; как только дописан —
    // опрос прекращается сам.
    refetchInterval: (query) => {
      const messages = (query.state.data ?? []) as AssistantMessage[];
      return messages.some((message) => message.status === "pending")
        ? POLL_MS
        : false;
    },
    queryFn: async (): Promise<AssistantMessage[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/ai-conversations/{conversation_id}",
        {
          params: {
            path: {
              patient_id: patientId,
              conversation_id: conversationId ?? "",
            },
          },
        },
      );
      if (error || !data)
        throw error ?? new Error("Empty conversation response");
      return data.messages as AssistantMessage[];
    },
  });
}

export function useAskAssistant(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      text: string;
      conversationId: string | null;
    }) => {
      const { data, error } = await api.POST("/api/v1/ai/assistant/messages", {
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
