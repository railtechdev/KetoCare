import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type PatientReport = components["schemas"]["PatientReport"];
export type ReportJob = components["schemas"]["ReportJobRead"];
export type SeizureByType = PatientReport["seizures"]["by_type"][number];

export interface ReportRange {
  from: string;
  to: string;
}

export function useReport(patientId: string, range: ReportRange) {
  return useQuery({
    queryKey: ["patient", patientId, "report", range.from, range.to],
    queryFn: async (): Promise<PatientReport> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/report",
        {
          params: {
            path: { patient_id: patientId },
            query: { from: range.from, to: range.to, format: "json" },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty report response");
      return data;
    },
  });
}

/**
 * Заказ PDF: ручка создаёт задачу, файл собирает воркер (раздел 7.5 ТЗ).
 *
 * Ответ кладётся в кэш задачи, чтобы поллинг подхватил её сразу и не ждал
 * первого интервала — иначе после нажатия кнопки экран несколько секунд молчит.
 */
export function useRequestPdfMutation(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (range: ReportRange): Promise<ReportJob> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/report/pdf",
        {
          params: {
            path: { patient_id: patientId },
            query: { from: range.from, to: range.to },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty report job response");
      return data;
    },
    onSuccess: (job) => {
      queryClient.setQueryData(["report-job", job.id], job);
    },
  });
}

/**
 * Поллинг задачи сборки.
 *
 * Интервал снимается, как только задача завершилась: незакрытый поллинг
 * продолжал бы дёргать сервер, пока экран открыт, — и на вкладке, забытой на
 * ночь, это заметно.
 */
export function useReportJob(jobId: string | null) {
  return useQuery({
    queryKey: ["report-job", jobId],
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "failed" ? false : 2000;
    },
    queryFn: async (): Promise<ReportJob> => {
      if (jobId === null) throw new Error("jobId is required");
      const { data, error } = await api.GET("/api/v1/reports/jobs/{job_id}", {
        params: { path: { job_id: jobId } },
      });
      if (error || !data) throw error ?? new Error("Empty report job response");
      return data;
    },
  });
}
