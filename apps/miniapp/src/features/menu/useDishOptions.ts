import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";
import { PAGE_SIZE } from "../recipes/useRecipes";

type RecipeRead = components["schemas"]["RecipeRead"];
export type CustomDish = components["schemas"]["CustomDishRead"];

export interface DishOption {
  /** Составной ключ: рецепты и свои блюда лежат в разных таблицах. */
  key: string;
  kind: "recipe" | "custom";
  id: string;
  title: string;
  kcal: number | null;
  ratio: number | null;
  /**
   * Совпадает ли соотношение с назначением ребёнка — решает сервер (у рецепта
   * `ratio_fits_prescription`). У своего блюда ответа нет: `undefined`.
   */
  fits: boolean | undefined;
  /** Порций в раскладке рецепта; у своего блюда их нет. */
  servings: number | null;
}

export function customDishesKey(patientId: string) {
  return ["patient", patientId, "custom-dishes"] as const;
}

/**
 * Блюда ребёнка целиком.
 *
 * Своих блюд у ребёнка единицы, поэтому список берётся целиком и отбирается на
 * месте: запрос на каждую букву ради десятка строк — лишняя задержка в
 * приложении, которое открывают из чата. Один запрос на сборку меню и на
 * список «Блюда ребёнка»: два ключа разошлись бы после сохранения блюда.
 */
export function useCustomDishes(patientId: string) {
  return useQuery({
    queryKey: customDishesKey(patientId),
    queryFn: async (): Promise<CustomDish[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/custom-dishes",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: 100, offset: 0 },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty dishes response");
      return data.items;
    },
  });
}

/**
 * Что можно поставить в день: опубликованные рецепты и свои блюда ребёнка.
 *
 * Оба списка вместе, потому что для семьи это один вопрос — «что сегодня
 * готовим». Рецепты приходят страницами: прежде выдача молча обрывалась на
 * двадцатом, и рецепт двадцать первым по алфавиту было не найти без поиска.
 * Теперь под списком стоит «Показать ещё».
 *
 * Черновики рецептов отсеивает сервер по роли (раздел 5.3 ТЗ). Клиент статус не
 * фильтрует: это была бы вторая реализация правила, расходящаяся со временем.
 */
export function useDishOptions(patientId: string, query: string) {
  const trimmed = query.trim();

  const recipes = useInfiniteQuery({
    queryKey: ["recipes", "options", patientId, trimmed],
    // Прошлая выдача держится, пока грузится новая: иначе список мигает
    // пустотой на каждой набранной букве.
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.GET("/api/v1/recipes", {
        params: {
          query: {
            q: trimmed === "" ? undefined : trimmed,
            patient_id: patientId,
            limit: PAGE_SIZE,
            offset: pageParam,
          },
        },
      });
      if (error || !data) throw error ?? new Error("Empty recipes response");
      return { items: data.items, total: data.total, offset: pageParam };
    },
    getNextPageParam: (last) => {
      const next = last.offset + last.items.length;
      return last.items.length > 0 && next < last.total ? next : undefined;
    },
  });
  const dishes = useCustomDishes(patientId);

  const matched = (dishes.data ?? []).filter(
    (dish) =>
      trimmed === "" ||
      dish.title.toLowerCase().includes(trimmed.toLowerCase()),
  );
  const recipeItems: RecipeRead[] = (recipes.data?.pages ?? []).flatMap(
    (page) => page.items,
  );

  const options: DishOption[] = [
    ...matched.map((dish) => ({
      key: `custom:${dish.id}`,
      kind: "custom" as const,
      id: dish.id,
      title: dish.title,
      kcal: dish.computed?.kcal ?? null,
      ratio: dish.computed?.ratio ?? null,
      fits: undefined,
      servings: null,
    })),
    ...recipeItems.map((recipe) => ({
      key: `recipe:${recipe.id}`,
      kind: "recipe" as const,
      id: recipe.id,
      title: recipe.title,
      kcal: recipe.per_portion?.kcal ?? recipe.computed?.kcal ?? null,
      ratio: recipe.per_portion?.ratio ?? recipe.computed?.ratio ?? null,
      fits: recipe.ratio_fits_prescription ?? undefined,
      servings: recipe.servings,
    })),
  ];

  return {
    options,
    // Ожидание — пока не пришёл ни один из двух списков: показывать половину
    // выдачи как полную значит предлагать выбрать из неполного.
    isPending: recipes.isPending || dishes.isPending,
    // Отказ ЛЮБОГО из двух списков — отказ выдачи: показать оставшийся как
    // полный значит сказать семье «своего блюда больше нет», и она поставит в
    // день другое.
    isError: recipes.isError || dishes.isError,
    isPaused:
      recipes.fetchStatus === "paused" || dishes.fetchStatus === "paused",
    hasMore: recipes.hasNextPage,
    loadingMore: recipes.isFetchingNextPage,
    loadMore: () => {
      void recipes.fetchNextPage();
    },
    refetch: () => {
      void recipes.refetch();
      void dishes.refetch();
    },
  };
}
