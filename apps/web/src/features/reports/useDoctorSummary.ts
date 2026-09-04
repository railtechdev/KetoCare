import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";
import type { ReportRange } from "./useReports";

export type DoctorSummary = components["schemas"]["SummaryRead"];
export type SummaryCheck = components["schemas"]["SummaryCheck"];

/** Пока черновик собирается, экран перечитывает состояние с сервера. */
const POLL_MS = 2500;

function key(patientId: string, range: ReportRange) {
  return ["patient", patientId, "summaries", range.from, range.to] as const;
}

/**
 * Сводки за выбранный период.
 *
 * Состояние сборки живёт на сервере, а не в `useState` экрана — в отличие от
 * задачи PDF. Разница не косметическая: каждая сборка черновика это платный
 * вызов модели из общего дневного бюджета, и задача, потерянная при F5,
 * означала бы второй такой вызов. Заодно врач видит черновик, заказанный с
 * другого устройства.
 */
export function useDoctorSummaries(
  patientId: string,
  range: ReportRange,
  enabled: boolean,
) {
  return useQuery({
    queryKey: key(patientId, range),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.[0]?.status;
      return status === "queued" || status === "running" ? POLL_MS : false;
    },
    queryFn: async (): Promise<DoctorSummary[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/summaries",
        {
          params: {
            path: { patient_id: patientId },
            query: { from: range.from, to: range.to },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty summaries response");
      return data;
    },
  });
}

/**
 * Заказ черновика.
 *
 * Ответ кладётся в кэш сразу: иначе после нажатия экран молчит до первого
 * интервала поллинга — тот же приём, что у заказа PDF.
 */
export function useRequestSummaryMutation(
  patientId: string,
  range: ReportRange,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<DoctorSummary> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/summaries",
        {
          params: {
            path: { patient_id: patientId },
            query: { from: range.from, to: range.to },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty summary response");
      return data;
    },
    onSuccess: (summary) => {
      queryClient.setQueryData(key(patientId, range), [summary]);
    },
  });
}

/**
 * Утверждение: момент, когда текст модели становится клиническими данными.
 *
 * Отчёт перечитывается вместе со сводками — утверждённый текст входит в него, и
 * экран, оставшийся со старым отчётом, показывал бы, что сводки в нём нет.
 */
export function useApproveSummaryMutation(
  patientId: string,
  range: ReportRange,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      summaryId: string;
      approvedMd: string;
    }): Promise<DoctorSummary> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/summaries/{summary_id}/approve",
        {
          params: {
            path: { patient_id: patientId, summary_id: input.summaryId },
          },
          body: { approved_md: input.approvedMd },
        },
      );
      if (error || !data) throw error ?? new Error("Empty approve response");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(patientId, range) });
      void queryClient.invalidateQueries({
        queryKey: ["patient", patientId, "report", range.from, range.to],
      });
    },
  });
}
