import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";
import { patientOverviewKey } from "../patients/overview";
import { menusKey } from "./useMenu";

export type MenuWeek = components["schemas"]["MenuWeekRead"];
export type MenuWeekCopy = components["schemas"]["MenuWeekCopyRead"];

/** Неделя как часть ключа меню: правка дня обновляет и сетку. */
export function useWeekQuery(patientId: string, start: string) {
  return useQuery({
    queryKey: [...menusKey(patientId), "week", start],
    queryFn: async (): Promise<MenuWeek> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/menus/week",
        {
          params: { path: { patient_id: patientId }, query: { start } },
        },
      );
      if (error || !data) throw error ?? new Error("Empty week response");
      return data;
    },
  });
}

export function useCopyWeek(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: "always",
    retry: false,
    mutationFn: async (input: {
      sourceStart: string;
      targetStart: string;
    }): Promise<MenuWeekCopy> => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/menus/week/copy",
        {
          params: { path: { patient_id: patientId } },
          body: {
            source_start: input.sourceStart,
            target_start: input.targetStart,
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty copy response");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: menusKey(patientId) });
      void queryClient.invalidateQueries({
        queryKey: patientOverviewKey(patientId),
      });
    },
  });
}
