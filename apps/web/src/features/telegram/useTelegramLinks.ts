import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type TelegramLink = components["schemas"]["TelegramLinkRead"];

/**
 * Привязка Telegram-чата к ребёнку (раздел 7 ТЗ, ADR-0009).
 *
 * Все три ручки существовали с самого начала и не вызывались ниоткуда: в
 * кабинете не было ни одного экрана, который бы их дёргал, — при том что сам
 * бот в приветствии просит нажать кнопку «Привязать Telegram». Бот был
 * запущен и недостижим.
 */
export function useTelegramLinks(patientId: string) {
  return useQuery({
    queryKey: ["telegram-links", patientId],
    queryFn: async (): Promise<TelegramLink[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/telegram",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty telegram links");
      return data;
    },
  });
}

export function useRevokeLinkMutation(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (linkId: string): Promise<TelegramLink> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/telegram/{link_id}/revoke",
        { params: { path: { patient_id: patientId, link_id: linkId } } },
      );
      if (error || !data) throw error ?? new Error("Empty revoke response");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["telegram-links", patientId],
      });
    },
  });
}
