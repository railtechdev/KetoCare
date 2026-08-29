import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { RecipeWriteBody } from "./types";

/**
 * Мутации базы рецептов (раздел 5.3 ТЗ: admin/dietitian).
 *
 * Каждая инвалидирует ключ `['recipes']` целиком — и список, и карточку:
 * показатели рецепта пересчитывает сервер, поэтому сохранённое локально тело
 * запроса не годится в качестве нового состояния.
 */
function useRecipesInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["recipes"] });
  };
}

export function useCreateRecipeMutation() {
  const invalidate = useRecipesInvalidation();

  return useMutation({
    mutationFn: async (body: RecipeWriteBody) => {
      const { data, error } = await api.POST("/api/v1/recipes", { body });
      if (error || !data) throw error ?? new Error("Empty create response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateRecipeMutation(recipeId: string | null) {
  const invalidate = useRecipesInvalidation();

  return useMutation({
    mutationFn: async (body: RecipeWriteBody) => {
      if (recipeId === null) throw new Error("recipeId is required to update");

      const { data, error } = await api.PUT("/api/v1/recipes/{recipe_id}", {
        params: { path: { recipe_id: recipeId } },
        body,
      });
      if (error || !data) throw error ?? new Error("Empty update response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function usePublishRecipeMutation() {
  const invalidate = useRecipesInvalidation();

  return useMutation({
    mutationFn: async (recipeId: string) => {
      const { data, error } = await api.POST(
        "/api/v1/recipes/{recipe_id}/publish",
        { params: { path: { recipe_id: recipeId } } },
      );
      if (error || !data) throw error ?? new Error("Empty publish response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteRecipeMutation() {
  const invalidate = useRecipesInvalidation();

  return useMutation({
    mutationFn: async (recipeId: string) => {
      // 204 без тела: успех подтверждается отсутствием error, а не данными.
      const { error } = await api.DELETE("/api/v1/recipes/{recipe_id}", {
        params: { path: { recipe_id: recipeId } },
      });
      if (error) throw error;
      return recipeId;
    },
    onSuccess: invalidate,
  });
}
