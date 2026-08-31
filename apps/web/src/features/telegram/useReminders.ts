import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type ReminderSettings = components["schemas"]["ReminderSettingsRead"];

/**
 * Настройки напоминаний ребёнка.
 *
 * Умолчания приходят с сервера, а не подставляются здесь: строка заводится при
 * первой правке, и вторая копия умолчаний однажды разошлась бы с первой —
 * экран показывал бы одно, а воркер напоминал по другому.
 */
export function useReminderSettings(patientId: string) {
  return useQuery({
    queryKey: ["patient", patientId, "reminders"],
    queryFn: async (): Promise<ReminderSettings> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/reminders",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty reminders response");
      return data;
    },
  });
}

export function useUpdateRemindersMutation(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (values: ReminderSettings): Promise<ReminderSettings> => {
      const { data, error } = await api.PUT(
        "/api/v1/patients/{patient_id}/reminders",
        {
          params: { path: { patient_id: patientId } },
          body: {
            enabled: values.enabled,
            ketones_at: values.ketones_at,
            weight_at: values.weight_at,
            medications_at: values.medications_at,
            no_records_at: values.no_records_at,
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty reminders response");
      return data;
    },
    onSuccess: (saved) =>
      queryClient.setQueryData(["patient", patientId, "reminders"], saved),
  });
}
