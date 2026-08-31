import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type Recipe = components["schemas"]["RecipeRead"];

/** Сколько рецептов приходит за раз. Больше на телефоне всё равно не пролистают. */
export const PAGE_SIZE = 20;

export function useRecipeSearch(query: string) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: ["recipes", "search", trimmed],
    // Прошлая выдача держится, пока грузится новая: иначе список мигает
    // пустотой на каждой набранной букве.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<Recipe[]> => {
      const { data, error } = await api.GET("/api/v1/recipes", {
        params: {
          query: {
            q: trimmed === "" ? undefined : trimmed,
            limit: PAGE_SIZE,
            offset: 0,
          },
        },
      });
      if (error || !data) throw error ?? new Error("Empty recipes response");
      return data.items;
    },
  });
}

/**
 * Один рецепт целиком.
 *
 * Список отдаёт те же поля, но карточка берётся отдельным запросом: рецепт
 * могли поправить с тех пор, как список загрузился, а по нему готовят.
 */
export function useRecipe(recipeId: string | null) {
  return useQuery({
    queryKey: ["recipes", recipeId],
    enabled: recipeId !== null,
    queryFn: async (): Promise<Recipe> => {
      const { data, error } = await api.GET("/api/v1/recipes/{recipe_id}", {
        params: { path: { recipe_id: recipeId as string } },
      });
      if (error || !data) throw error ?? new Error("Empty recipe response");
      return data;
    },
  });
}
