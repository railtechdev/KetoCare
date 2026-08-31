import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type TelegramLink = components["schemas"]["TelegramLinkRead"];
export type LinkCode = components["schemas"]["LinkCodeCreated"];

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

/**
 * Выпуск кода привязки.
 *
 * Код живёт 15 минут и гасится первым же использованием, поэтому он не
 * кэшируется и не хранится: каждый показ — это новый код. Список привязок после
 * выпуска не трогаем — привязка появится только когда родитель дойдёт до бота.
 */
export function useCreateLinkCodeMutation(patientId: string) {
  return useMutation({
    mutationFn: async (): Promise<LinkCode> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/link-codes",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty link code response");
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
