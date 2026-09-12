import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";

import { productNameState, type ProductName } from "@ketocare/ui";

import { api } from "../../lib/api";
import {
  fetchProductDetail,
  productDetailKey,
  type ProductDetail,
} from "../products/useProductDetail";
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
  /**
   * Продукты состава, выведенные из оборота.
   *
   * Вывод убирает продукт из поиска, но не из уже сохранённых рецептов — и
   * правильно: рецепт, по которому кормили, не подменяется задним числом.
   * Молчать об этом нельзя: выводят продукт обычно потому, что его числа
   * оказались неверными, а по ним посчитаны показатели рецепта.
   */
  withdrawn: Record<string, string>;
  /**
   * Что известно об имени строки состава.
   *
   * Словаря «идентификатор → имя» здесь намеренно нет: по отсутствию ключа
   * неразличимы «продукт удалён из справочника» и «название не загрузилось», а
   * разница между ними — это разница между утверждением о справочнике и
   * утверждением о связи.
   */
  stateOf: (productId: string) => ProductName;
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
  const details = useProductDetails(productIds);

  const withdrawn: Record<string, string> = {};
  for (const product of Object.values(details.byId)) {
    if (!product.is_active) withdrawn[product.id] = product.name_ru;
  }

  return {
    withdrawn,
    stateOf: details.stateOf,
    isLoading: details.isLoading,
  };
}

export interface ProductDetails {
  byId: Record<string, ProductDetail>;
  /**
   * В составе есть продукт, которого больше нет в справочнике.
   *
   * Молчать об этом нельзя: без его карточки расчёт не уйдёт никогда, и форма
   * показывала бы пустоту вместо чисел — без единого слова о причине.
   */
  hasMissing: boolean;
  /** Что известно об имени продукта: пришло, удалён, не загрузилось, ждём */
  stateOf: (productId: string) => ProductName;
  isLoading: boolean;
  /** Хотя бы одну карточку получить не удалось */
  isError: boolean;
}

/**
 * Карточки продуктов состава целиком.
 *
 * Рецепт приходит с составом из `product_id` и граммов: ни названий, ни
 * значений на 100 г в нём нет. Названия нужны, чтобы показать состав, значения
 * — чтобы посчитать показатели блюда по мере правки: `/calc/verify` ждёт
 * продукты вместе с их составом на 100 г, и взять их больше неоткуда.
 *
 * Ключ `['products','detail',id]` общий для всех экранов, так что повторно
 * открытый рецепт берёт карточки из кеша, а не из сети.
 */
export function useProductDetails(productIds: string[]): ProductDetails {
  const unique = Array.from(new Set(productIds)).filter((id) => id !== "");

  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: productDetailKey(id),
      // Справочник продуктов меняется редко: перезапрашивать карточку при
      // каждом открытии рецепта незачем.
      staleTime: 5 * 60 * 1000,
      // Запрос — общий с карточкой продукта: у общего ключа обязано быть
      // общее значение, иначе `null` («такого продукта нет») читается соседом
      // как «данных нет вовсе».
      queryFn: () => fetchProductDetail(id),
    })),
  });

  const byId: Record<string, ProductDetail> = {};
  for (const result of results) {
    if (result.data) byId[result.data.id] = result.data;
  }

  // Состояние имени — построчное, по тому же правилу, что в Mini App.
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
    byId,
    hasMissing: results.some((result) => result.data === null),
    stateOf: (productId: string) =>
      states.get(productId) ?? { kind: "pending" as const },
    isLoading: results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
  };
}
