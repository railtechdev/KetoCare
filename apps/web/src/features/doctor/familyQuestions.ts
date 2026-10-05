import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type FamilyConversation = components["schemas"]["ConversationListItem"];

/** Сколько разговоров приходит за раз; «Показать ещё» добавляет столько же. */
export const FAMILY_QUESTIONS_PAGE = 30;

/**
 * Разговоры семьи с помощником — для специалиста, на чтение (ADR-0022).
 *
 * Сервер отдаёт их от новых к старым и вместе с числом отказов помощника
 * (`refused_count`): по нему перечень показывает, какие вопросы ждут человека,
 * не открывая каждый разговор — открытие пишется в журнал аудита.
 */
export function useFamilyConversations(patientId: string, limit: number) {
  return useQuery({
    queryKey: ["patient", patientId, "ai-conversations", limit],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/ai-conversations",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit, offset: 0 },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty conversations");
      return data;
    },
  });
}
