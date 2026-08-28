import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type Patient = components["schemas"]["PatientRead"];
export type PatientCreateBody = components["schemas"]["PatientCreate"];
export type PatientUpdateBody = components["schemas"]["PatientUpdate"];

/**
 * Заведение и правка профиля ребёнка.
 *
 * Обе мутации инвалидируют `['patients']` — тот же ключ, что читает
 * `usePatients`: список детей определяет, кого вообще показывают экраны, и
 * устаревший здесь означает «нового ребёнка не видно».
 */
function useChildrenInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["patients"] });
  };
}

export function useCreateChildMutation() {
  const invalidate = useChildrenInvalidation();

  return useMutation({
    mutationFn: async (body: PatientCreateBody): Promise<Patient> => {
      const { data, error } = await api.POST("/api/v1/patients", { body });
      if (error || !data)
        throw error ?? new Error("Empty create patient response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateChildMutation(patientId: string) {
  const invalidate = useChildrenInvalidation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: PatientUpdateBody): Promise<Patient> => {
      const { data, error } = await api.PATCH("/api/v1/patients/{patient_id}", {
        params: { path: { patient_id: patientId } },
        body,
      });
      if (error || !data)
        throw error ?? new Error("Empty update patient response");
      return data;
    },
    onSuccess: () => {
      invalidate();
      // Рост и аллергии участвуют в назначении и в составе меню, поэтому сводка
      // пациента после правки профиля перестаёт быть актуальной.
      void queryClient.invalidateQueries({ queryKey: ["patient", patientId] });
    },
  });
}
