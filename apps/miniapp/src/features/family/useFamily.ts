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

function codesKey(patientId: string) {
  return ["patient", patientId, "access-codes"] as const;
}

/**
 * Уже выданное и ещё живое приглашение близкому — из журнала кодов.
 *
 * Прежде каждое нажатие «Пригласить» выпускало новый код: у ребёнка копились
 * действующие неделю коды, каждый — дверь к его данным, а родитель, открывший
 * приложение снова, не видел уже отправленного. Теперь живое приглашение
 * показывается, и новое выпускается, только когда живого нет.
 */
export function useActiveInvitation(patientId: string) {
  return useQuery({
    queryKey: codesKey(patientId),
    queryFn: async (): Promise<Invitation | null> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/access-codes",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty codes response");
      const now = Date.now();
      const live = data
        .filter(
          (row) =>
            row.purpose === "family_member" &&
            row.status === "pending" &&
            row.code !== null &&
            row.join_url != null &&
            new Date(row.expires_at).getTime() > now,
        )
        // Свежий — последним выданный: у него и срок дольше.
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return live === undefined || live.code === null || live.join_url == null
        ? null
        : {
            code: live.code,
            expires_at: live.expires_at,
            deep_link: live.deep_link ?? null,
            join_url: live.join_url,
          };
    },
  });
}

/** Приглашение близкому: код с назначением «другой взрослый» (ADR-0042). */
export function useInvite(patientId: string) {
  const queryClient = useQueryClient();
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: codesKey(patientId) });
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
