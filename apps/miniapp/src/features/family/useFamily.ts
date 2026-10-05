import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type FamilyMember = components["schemas"]["FamilyMemberRead"];
export type Invitation = components["schemas"]["AccessCodeCreated"];

function familyKey(patientId: string) {
  return ["patient", patientId, "family"] as const;
}

/** Близкие ребёнка — тот же список, что у кабинета и у врача (ADR-0043). */
export function useFamily(patientId: string) {
  return useQuery({
    queryKey: familyKey(patientId),
    queryFn: async (): Promise<FamilyMember[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/parents",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty family response");
      return data;
    },
  });
}

/** Приглашение близкому: код с назначением «другой взрослый» (ADR-0042). */
export function useInvite(patientId: string) {
  return useMutation({
    mutationFn: async (): Promise<Invitation> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/access-codes",
        {
          params: { path: { patient_id: patientId } },
          body: { purpose: "family_member" },
        },
      );
      if (error || !data) throw error ?? new Error("Empty invite response");
      return data;
    },
  });
}

/** Закрыть доступ тому, кого позвал этот родитель. Право считает сервер. */
export function useRemoveMember(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (parentId: string): Promise<void> => {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/parents/{parent_id}",
        { params: { path: { patient_id: patientId, parent_id: parentId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: familyKey(patientId) });
    },
  });
}
