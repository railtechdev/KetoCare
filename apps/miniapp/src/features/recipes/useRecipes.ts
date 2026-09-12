import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { productNameState, type ProductName } from "@ketocare/ui";

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

/**
 * Названия продуктов состава — по их карточкам.
 *
 * Рецепт хранит только `product_id`: продукт могут переименовать, и снимка имён
 * у рецепта нет. Ключ `['products','detail',id]` тот же, что в кабинете:
 * повторно открытый рецепт берёт названия из кэша, а не из сети.
 */
export function useProductNames(productIds: string[]): {
  stateOf: (productId: string) => ProductName;
} {
  const unique = Array.from(new Set(productIds));

  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: ["products", "detail", id],
      // Справочник меняется редко: перезапрашивать имя при каждом открытии
      // карточки незачем.
      staleTime: 5 * 60 * 1000,
      queryFn: async () => {
        const { data, error, response } = await api.GET(
          "/api/v1/products/{product_id}",
          { params: { path: { product_id: id } } },
        );
        // 404 — это ответ справочника «такого продукта нет», а не сбой связи.
        // Бросить здесь значило бы смешать удаление с недоставленным ответом.
        // Тот же запрос есть в кабинете (`apps/web/src/features/products/
        // useProductDetail.ts`): кэш у приложений разный, но правило одно, и
        // разбор состояний для обоих лежит в ките (`productNameState`).
        if (response.status === 404) return null;
        if (error || !data) throw error ?? new Error("Empty product response");
        return data;
      },
    })),
  });

  // Разбор — общий с кабинетом (`productNameState` в ките): один и тот же
  // рецепт в двух каналах обязан различать эти случаи одинаково.
  const states = new Map<string, ProductName>();
  unique.forEach((id, index) => {
    const result = results[index];
    if (result === undefined) return;
    states.set(
      id,
      productNameState({
        name:
          result.data === undefined
            ? undefined
            : (result.data?.name_ru ?? null),
        isError: result.isError,
        isPaused: result.fetchStatus === "paused",
      }),
    );
  });

  return {
    stateOf: (productId) => states.get(productId) ?? { kind: "pending" },
  };
}
