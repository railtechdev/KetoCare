import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";
import { customDishesKey } from "./useCustomDishes";

export type RecipeFitsResponse = components["schemas"]["RecipeFitsResponse"];
export type RecipeFit = components["schemas"]["RecipeFit"];

/** Подгонка считает, но ничего не записывает. */
export function useFitRecipes(patientId: string) {
  return useMutation({
    networkMode: "online",
    mutationFn: async (recipeIds: string[]) => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/recipe-fits",
        {
          params: { path: { patient_id: patientId } },
          body: { recipe_ids: recipeIds },
        },
      );
      if (error || !data) throw error ?? new Error("Empty fit response");
      return data;
    },
  });
}

export interface FitToSave {
  /** Ключ попытки: повтор после обрыва не создаёт второе блюдо (ADR-0035) */
  idempotencyKey: string;
  title: string;
  ingredients: { product_id: string; grams: number }[];
}

/**
 * Сохраняет выбранные блюда по одному обычной ручкой записи.
 *
 * При отказе посередине уже записанные остаются: повтор с теми же ключами
 * получает прежние ответы и дописывает остальные.
 */
export function useSaveFits(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: "always",
    retry: false,
    mutationFn: async (fits: FitToSave[]) => {
      for (const fit of fits) {
        const { data, error } = await api.POST(
          "/api/v1/patients/{patient_id}/custom-dishes",
          {
            params: {
              path: { patient_id: patientId },
              header: { "Idempotency-Key": fit.idempotencyKey },
            },
            body: {
              title: fit.title,
              ingredients: fit.ingredients,
              reject_excluded: true,
            },
          },
        );
        if (error || !data) throw error ?? new Error("Empty save response");
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: customDishesKey(patientId),
      }),
  });
}
