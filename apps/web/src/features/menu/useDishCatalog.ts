import type { components } from "@ketocare/api-client";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { api } from "../../lib/api";
import type { DishKind, MenuItemRead } from "./useMenu";

type RecipeRead = components["schemas"]["RecipeRead"];
type CustomDishRead = components["schemas"]["CustomDishRead"];

export interface DishOption {
  /** Составной ключ: идентификаторы рецептов и своих блюд живут в разных таблицах */
  key: string;
  kind: DishKind;
  id: string;
  title: string;
  /** Показатели раскладки целиком; `null`, пока ядро их не посчитало */
  kcal: number | null;
  ratio: number | null;
  /** Число порций в раскладке рецепта — у своего блюда его нет */
  servings: number | null;
}

export function dishKey(kind: DishKind, id: string): string {
  return `${kind}:${id}`;
}

/** Ключ источника позиции меню: ровно одна из двух ссылок заполнена. */
export function itemDishKey(item: MenuItemRead): string | null {
  if (item.recipe_id !== null) return dishKey("recipe", item.recipe_id);
  if (item.custom_dish_id !== null)
    return dishKey("custom", item.custom_dish_id);
  return null;
}

/**
 * Варианты для добавления в меню: опубликованные рецепты и свои блюда пациента.
 *
 * Черновики рецептов отсеивает сервер по роли (раздел 5.3 ТЗ) — клиент статус не
 * фильтрует: это была бы вторая, расходящаяся со временем реализация правила.
 */
export function useDishOptions(patientId: string | null, query: string) {
  const trimmed = query.trim();

  const dishes = useCustomDishes(patientId);

  const recipes = useQuery({
    queryKey: ["recipes", "search", trimmed],
    // Ниже двух символов выдача бесполезна, а запрос к полнотекстовому индексу
    // уходит на каждую букву.
    enabled: trimmed.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<RecipeRead[]> => {
      const { data, error } = await api.GET("/api/v1/recipes", {
        params: { query: { q: trimmed, limit: 20, offset: 0 } },
      });
      if (error || !data) throw error ?? new Error("Empty recipes response");
      return data.items;
    },
  });

  const options = useMemo<DishOption[]>(() => {
    const needle = trimmed.toLocaleLowerCase("ru-RU");

    // Свои блюда отдаются списком без поиска, поэтому отбираются здесь.
    const custom = (dishes.data ?? [])
      .filter(
        (dish) =>
          needle === "" ||
          dish.title.toLocaleLowerCase("ru-RU").includes(needle),
      )
      .map(toCustomOption);

    const found =
      trimmed.length >= 2 ? (recipes.data ?? []).map(toRecipeOption) : [];

    return [...custom, ...found];
  }, [dishes.data, recipes.data, trimmed]);

  return {
    options,
    isFetching: dishes.isFetching || recipes.isFetching,
    isError: dishes.isError || recipes.isError,
    error: dishes.error ?? recipes.error,
  };
}

/**
 * Названия блюд для позиций дня.
 *
 * `MenuItemRead` несёт только ссылки, поэтому названия догружаются: рецепты —
 * поштучно по идентификатору, свои блюда — из общего списка пациента.
 */
export function useMenuItemTitles(
  patientId: string | null,
  items: readonly MenuItemRead[],
): Record<string, string> {
  const dishes = useCustomDishes(patientId);

  const recipeIds = useMemo(() => {
    const ids = items
      .map((item) => item.recipe_id)
      .filter((id): id is string => id !== null);
    return [...new Set(ids)].sort();
  }, [items]);

  // Ключ тот же, что у карточки рецепта (`['recipes','detail',id]`): открытый
  // из меню рецепт берётся из кеша, а не запрашивается второй раз.
  const recipes = useQueries({
    queries: recipeIds.map((id) => ({
      queryKey: ["recipes", "detail", id],
      queryFn: async (): Promise<RecipeRead> => {
        const { data, error } = await api.GET("/api/v1/recipes/{recipe_id}", {
          params: { path: { recipe_id: id } },
        });
        if (error || !data) throw error ?? new Error("Empty recipe response");
        return data;
      },
    })),
  });

  // Рецепт, скрытый от родителя или удалённый, сервер отдаёт как 404: позиция
  // останется без названия, но остальной день показывается как обычно.
  const found = recipes
    .map((result) => result.data)
    .filter((recipe): recipe is RecipeRead => recipe !== undefined);

  const titles: Record<string, string> = {};
  for (const dish of dishes.data ?? []) {
    titles[dishKey("custom", dish.id)] = dish.title;
  }
  for (const recipe of found) {
    titles[dishKey("recipe", recipe.id)] = recipe.title;
  }
  return titles;
}

/** Свои блюда пациента. Ключ общий с калькулятором — список там же и меняется. */
function useCustomDishes(patientId: string | null) {
  return useQuery({
    queryKey: ["patient", patientId, "custom-dishes"],
    enabled: patientId !== null,
    queryFn: async (): Promise<CustomDishRead[]> => {
      if (patientId === null) throw new Error("patientId is required");

      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/custom-dishes",
        {
          params: {
            path: { patient_id: patientId },
            query: { limit: 200, offset: 0 },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty dishes response");
      return data.items;
    },
  });
}

function toRecipeOption(recipe: RecipeRead): DishOption {
  return {
    key: dishKey("recipe", recipe.id),
    kind: "recipe",
    id: recipe.id,
    title: recipe.title,
    kcal: recipe.computed?.kcal ?? null,
    ratio: recipe.computed?.ratio ?? null,
    servings: recipe.servings,
  };
}

function toCustomOption(dish: CustomDishRead): DishOption {
  return {
    key: dishKey("custom", dish.id),
    kind: "custom",
    id: dish.id,
    title: dish.title,
    kcal: dish.computed?.kcal ?? null,
    ratio: dish.computed?.ratio ?? null,
    servings: null,
  };
}
