import type { components } from "@ketocare/api-client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { api } from "../../lib/api";
import { menusKey } from "./useMenu";

export type DishUsageEntry = components["schemas"]["DishUsageEntry"];

export interface DishUsage {
  recipe: (id: string) => DishUsageEntry | undefined;
  dish: (id: string) => DishUsageEntry | undefined;
}

/**
 * «Уже давали»: где рецепты и блюда ребёнка стояли в его меню (ADR-0089).
 *
 * Ключ лежит под меню пациента: любое сохранение дня сбрасывает его вместе с
 * днями, и пометка не отстаёт от недели.
 */
export function useDishUsage(patientId: string | null): DishUsage {
  const query = useQuery({
    queryKey: [...menusKey(patientId), "dish-usage"],
    enabled: patientId !== null,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/menus/dish-usage",
        { params: { path: { patient_id: patientId as string } } },
      );
      if (error || !data) throw error ?? new Error("Empty usage response");
      return data;
    },
  });

  return useMemo(() => {
    const recipes = new Map(
      (query.data?.recipes ?? []).map((entry) => [entry.id, entry]),
    );
    const dishes = new Map(
      (query.data?.dishes ?? []).map((entry) => [entry.id, entry]),
    );
    return {
      recipe: (id: string) => recipes.get(id),
      dish: (id: string) => dishes.get(id),
    };
  }, [query.data]);
}
