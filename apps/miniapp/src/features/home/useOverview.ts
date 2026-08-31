import { useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type Overview = components["schemas"]["PatientOverview"];

/**
 * Сводка пациента одним запросом (раздел 8.3 ТЗ).
 *
 * Один на всё приложение: её показывает главная и по ней же калькулятор берёт
 * назначенное соотношение. Две копии запроса делили бы кэш, но расходились бы в
 * обработке — а какая выполнится, решал бы порядок отрисовки.
 */
export function usePatientOverview(patientId: string) {
  return useQuery({
    queryKey: ["patient", patientId, "overview"],
    queryFn: async (): Promise<Overview> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/overview",
        {
          params: { path: { patient_id: patientId } },
        },
      );
      if (error || !data) throw error ?? new Error("Empty overview response");
      return data;
    },
  });
}
