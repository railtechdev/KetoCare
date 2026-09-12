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
 * То же число, что в кабинете, и по той же причине: `/ai/*` ограничен
 * шестьюдесятью запросами в минуту, и опрос чаще упрётся в собственный лимит.
 */
const POLL_MS = 2500;

/**
 * Последняя переписка семьи с помощником.
 *
 * В Mini App это не удобство, а необходимость: каждый запуск из чата — новая
 * загрузка страницы, и идентификатор переписки, живущий в состоянии экрана,
 * теряется ВСЕГДА. Родитель спрашивал, получал ответ, закрывал приложение — и
 * при следующем открытии видел пустой чат, хотя разговор лежал на сервере и был
 * доступен лечащему врачу (ADR-0022).
 */
export function useLatestConversationId(patientId: string) {
  return useQuery({
    queryKey: ["assistant", patientId, "latest"],
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
    queryKey: ["assistant", conversationId],
    enabled: conversationId !== null,
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
      void queryClient.invalidateQueries({
        queryKey: ["assistant", accepted.conversation_id],
      });
    },
  });
}
