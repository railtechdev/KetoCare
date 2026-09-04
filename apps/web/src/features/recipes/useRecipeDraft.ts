import { useMutation } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type RecipeDraft = components["schemas"]["RecipeDraftResponse"];
export type DraftCheck = components["schemas"]["DraftCheck"];

export interface DraftInput {
  title: string;
  category: components["schemas"]["RecipeCategory"];
  servings: number;
  ingredients: { product_id: string; grams: number }[];
}

/**
 * Черновик способа приготовления по уже собранному составу.
 *
 * Ничего не сохраняет: текст возвращается в поле формы, редактор его правит и
 * сохраняет рецепт обычной кнопкой. Правило 6 CLAUDE.md выполняется самой
 * формой работы — отдельного подтверждения не нужно.
 */
export function useRecipeDraftMutation() {
  return useMutation({
    mutationFn: async (input: DraftInput): Promise<RecipeDraft> => {
      const { data, error } = await api.POST("/api/v1/ai/recipe-draft", {
        body: input,
      });
      if (error || !data) throw error ?? new Error("Empty draft response");
      return data;
    },
  });
}
