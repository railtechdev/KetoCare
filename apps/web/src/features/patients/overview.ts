import { useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type PatientOverview = components["schemas"]["PatientOverview"];

/**
 * Сводка пациента одним запросом (раздел 8.3 ТЗ).
 *
 * Назначение, итоги дня, последние кетоны и вес, приступы за сегодня собирает
 * сервер: разложить это на отдельные запросы к `/logs` и `/menus` значило бы
 * показать четыре части дня, снятые в четыре разных момента, — на границе суток
 * итоги и приступы относились бы к разным датам.
 *
 * Запрос живёт здесь, а не в разделе: одну и ту же сводку показывают главная
 * родителя, экран меню (вердикт о допусках) и карта пациента у врача. Ключ у
 * них общий, поэтому копии запроса делили бы кэш, но расходились бы в
 * обработке — а какой из них выполнится, решал бы порядок монтирования.
 */
export function patientOverviewKey(patientId: string | null) {
  return ["patient", patientId, "overview"] as const;
}

export function patientOverviewQuery(patientId: string | null) {
  return {
    queryKey: patientOverviewKey(patientId),
    enabled: patientId !== null,
    queryFn: async (): Promise<PatientOverview> => {
      if (patientId === null) throw new Error("patientId is required");

      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/overview",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty overview response");
      return data;
    },
  };
}

export function usePatientOverview(patientId: string | null) {
  return useQuery(patientOverviewQuery(patientId));
}
