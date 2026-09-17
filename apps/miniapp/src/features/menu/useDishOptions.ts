import { keepPreviousData, useQueries } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

type RecipeRead = components["schemas"]["RecipeRead"];
type CustomDishRead = components["schemas"]["CustomDishRead"];

export interface DishOption {
  /** Составной ключ: рецепты и свои блюда лежат в разных таблицах. */
  key: string;
  kind: "recipe" | "custom";
  id: string;
  title: string;
  kcal: number | null;
  ratio: number | null;
  /** Порций в раскладке рецепта; у своего блюда их нет. */
  servings: number | null;
}

/** Сколько вариантов показывать: больше на телефоне всё равно не пролистают. */
const LIMIT = 20;

/**
 * Что можно поставить в день: опубликованные рецепты и свои блюда ребёнка.
 *
 * Оба списка вместе, потому что для семьи это один вопрос — «что сегодня
 * готовим». Разделять их на две вкладки значило бы заставить родителя помнить,
 * где он завёл блюдо.
 *
 * Черновики рецептов отсеивает сервер по роли (раздел 5.3 ТЗ). Клиент статус не
 * фильтрует: это была бы вторая реализация правила, расходящаяся со временем.
 */
export function useDishOptions(patientId: string, query: string) {
  const trimmed = query.trim();

  const [recipes, dishes] = useQueries({
    queries: [
      {
        queryKey: ["recipes", "search", trimmed],
        // Прошлая выдача держится, пока грузится новая: иначе список мигает
        // пустотой на каждой набранной букве.
        placeholderData: keepPreviousData,
        queryFn: async (): Promise<RecipeRead[]> => {
          const { data, error } = await api.GET("/api/v1/recipes", {
            params: {
              query: {
                q: trimmed === "" ? undefined : trimmed,
                limit: LIMIT,
                offset: 0,
              },
            },
          });
          if (error || !data)
            throw error ?? new Error("Empty recipes response");
          return data.items;
        },
      },
      {
        // Своих блюд у ребёнка единицы, поэтому список берётся целиком и
        // отбирается на месте: запрос на каждую букву ради десятка строк —
        // лишняя задержка в приложении, которое открывают из чата.
        queryKey: ["patient", patientId, "custom-dishes"],
        queryFn: async (): Promise<CustomDishRead[]> => {
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
      },
    ],
  });

  const matched = (dishes.data ?? []).filter(
    (dish) =>
      trimmed === "" ||
      dish.title.toLowerCase().includes(trimmed.toLowerCase()),
  );

  const options: DishOption[] = [
    ...matched.map((dish) => ({
      key: `custom:${dish.id}`,
      kind: "custom" as const,
      id: dish.id,
      title: dish.title,
      kcal: dish.computed?.kcal ?? null,
      ratio: dish.computed?.ratio ?? null,
      servings: null,
    })),
    ...(recipes.data ?? []).map((recipe) => ({
      key: `recipe:${recipe.id}`,
      kind: "recipe" as const,
      id: recipe.id,
      title: recipe.title,
      kcal: recipe.computed?.kcal ?? null,
      ratio: recipe.computed?.ratio ?? null,
      servings: recipe.servings,
    })),
  ];

  return {
    options,
    // Ожидание — пока не пришёл ни один из двух списков: показывать половину
    // выдачи как полную значит предлагать выбрать из неполного.
    isPending: recipes.isPending || dishes.isPending,
    isError: recipes.isError && dishes.isError,
    isPaused:
      recipes.fetchStatus === "paused" || dishes.fetchStatus === "paused",
    refetch: () => {
      void recipes.refetch();
      void dishes.refetch();
    },
  };
}
