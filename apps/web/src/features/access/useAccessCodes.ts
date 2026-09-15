import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type AccessCodeCreated = components["schemas"]["AccessCodeCreated"];
export type AccessCodeRead = components["schemas"]["AccessCodeRead"];

/** Ключ журнала кодов ребёнка — ветка пациента, как и остальные его данные. */
function journalKey(patientId: string) {
  return ["patient", patientId, "access-codes"] as const;
}

export function useAccessCodes(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: journalKey(patientId),
    // Запрашивается только когда панель открыта: журнал кодов не нужен всем,
    // кто открыл карту, а выдача доступа — редкая операция.
    enabled,
    queryFn: async (): Promise<AccessCodeRead[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/access-codes",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data)
        throw error ?? new Error("Empty access codes response");
      return data;
    },
  });
}

export function useIssueAccessCode(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<AccessCodeCreated> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/access-codes",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty issue response");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: journalKey(patientId) });
    },
  });
}

export function useRevokeAccessCode(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (code: string): Promise<void> => {
      const { error } = await api.POST(
        "/api/v1/patients/{patient_id}/access-codes/{code}/revoke",
        { params: { path: { patient_id: patientId, code } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: journalKey(patientId) });
      // Пометка «доступ не активирован» в списке и в карте производна от
      // семьи, а не от кодов, — но отозванный код меняет то, что видит врач в
      // журнале, и сводку трогать незачем.
    },
  });
}

/** Активация кода тем, кто уже вошёл: второй ребёнок или второй родитель. */
export function useClaimAccessCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await api.POST(
        "/api/v1/users/me/access-codes/activate",
        { body: { code } },
      );
      if (error || !data) throw error ?? new Error("Empty claim response");
      return data;
    },
    onSuccess: () => {
      // Список детей определяет, кого вообще показывают экраны семьи.
      void queryClient.invalidateQueries({ queryKey: ["patients"] });
    },
  });
}
