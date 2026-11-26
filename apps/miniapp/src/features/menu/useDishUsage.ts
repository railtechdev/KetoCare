import type { components } from "@ketocare/api-client";
import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

export type DishUsageEntry = components["schemas"]["DishUsageEntry"];

/**
 * Где блюда ребёнка стоят в его меню — та же ручка, что «уже давали» в
 * кабинете (ADR-0089).
 *
 * После двух поправок в списке «Блюда ребёнка» стояли три «Суп Борщ» с разными
 * калориями, и какое из них в меню, видно не было (аудит 26.11.2026, 3.18).
 */
export function useDishUsage(patientId: string) {
  return useQuery({
    queryKey: ["patient", patientId, "menu", "dish-usage"],
    queryFn: async (): Promise<Map<string, DishUsageEntry>> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/menus/dish-usage",
        { params: { path: { patient_id: patientId } } },
      );
      if (error || !data) throw error ?? new Error("Empty usage response");
      return new Map(data.dishes.map((entry) => [entry.id, entry]));
    },
  });
}
