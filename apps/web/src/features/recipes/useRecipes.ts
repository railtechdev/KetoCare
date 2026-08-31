import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { toRecipeSearchQuery, type RecipeFilters } from "./types";

/**
 * Поиск рецептов (раздел 5.3 ТЗ).
 *
 * Видимость определяет сервер: родителю он отдаёт только опубликованные
 * рецепты, клиент статусы не фильтрует.
 */
export function useRecipeSearch(filters: RecipeFilters, enabled: boolean) {
  const query = toRecipeSearchQuery(filters);

  return useQuery({
    queryKey: ["recipes", "list", query],
    enabled,
    // Прошлая выдача держится на экране, пока грузится новая: иначе список
    // мигает пустотой на каждой набранной букве и при смене фильтра.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/recipes", {
        params: { query },
      });
      if (error || !data) throw error ?? new Error("Empty recipes response");
      return data;
    },
  });
}

export function useRecipe(recipeId: string | null) {
  return useQuery({
    queryKey: ["recipes", "detail", recipeId],
    enabled: recipeId !== null,
    queryFn: async () => {
      if (recipeId === null) throw new Error("recipeId is required");

      const { data, error } = await api.GET("/api/v1/recipes/{recipe_id}", {
        params: { path: { recipe_id: recipeId } },
      });
      if (error || !data) throw error ?? new Error("Empty recipe response");
      return data;
    },
  });
}

export interface ProductNames {
  /** Название продукта по его идентификатору; отсутствует, пока запрос не завершён */
  byId: Record<string, string>;
  /**
   * Продукты состава, выведенные из оборота.
   *
   * Вывод убирает продукт из поиска, но не из уже сохранённых рецептов — и
   * правильно: рецепт, по которому кормили, не подменяется задним числом.
   * Молчать об этом нельзя: выводят продукт обычно потому, что его числа
   * оказались неверными, а по ним посчитаны показатели рецепта.
   */
  withdrawn: Record<string, string>;
  isLoading: boolean;
}

/**
 * Названия продуктов состава.
 *
 * Рецепт приходит с составом из `product_id` и граммов — названий в нём нет,
 * поэтому они запрашиваются по карточке продукта. Ключ `['products','detail',id]`
 * общий для всех экранов, так что повторно открытый рецепт берёт названия из
 * кеша, а не из сети.
 */
export function useProductNames(productIds: string[]): ProductNames {
  const unique = Array.from(new Set(productIds));

  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: ["products", "detail", id],
      // Справочник продуктов меняется редко: перезапрашивать название при
      // каждом открытии карточки незачем.
      staleTime: 5 * 60 * 1000,
      queryFn: async () => {
        const { data, error } = await api.GET("/api/v1/products/{product_id}", {
          params: { path: { product_id: id } },
        });
        if (error || !data) throw error ?? new Error("Empty product response");
        return data;
      },
    })),
  });

  const byId: Record<string, string> = {};
  const withdrawn: Record<string, string> = {};
  for (const result of results) {
    if (!result.data) continue;
    byId[result.data.id] = result.data.name_ru;
    if (!result.data.is_active) withdrawn[result.data.id] = result.data.name_ru;
  }

  return {
    byId,
    withdrawn,
    isLoading: results.some((result) => result.isLoading),
  };
}
