import { useQueries, useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";
import { useCustomDishes } from "../dishes/useCustomDishes";
import type { DishRow } from "./types";
import type { ProductOption } from "./useProducts";

type Recipe = components["schemas"]["RecipeRead"];
type CustomDish = components["schemas"]["CustomDishRead"];

/**
 * Что пришло в калькулятор через `?item=`.
 *
 * Раньше это был только идентификатор продукта из справочника. Теперь тем же
 * параметром приходит готовое блюдо — рецепт или своя раскладка: у вкладки
 * «Пересчитать» не было источника вовсе, и «пересчитать готовое блюдо»
 * начиналось с набора состава руками, то есть не давало ничего сверх
 * «Проверить».
 *
 * Префикс, а не отдельный параметр: значение по-прежнему описывает один
 * предмет, который экран должен открыть, и разбирать его в одном месте дешевле,
 * чем сводить два параметра, которые могут прийти вместе.
 */
export type Incoming =
  | { kind: "product"; id: string }
  | { kind: "recipe"; id: string }
  | { kind: "dish"; id: string };

export function parseIncoming(item: string | undefined): Incoming | null {
  if (item === undefined || item === "") return null;
  if (item.startsWith("recipe:")) {
    return { kind: "recipe", id: item.slice("recipe:".length) };
  }
  if (item.startsWith("dish:")) {
    return { kind: "dish", id: item.slice("dish:".length) };
  }
  return { kind: "product", id: item };
}

export function incomingRecipe(recipeId: string): string {
  return `recipe:${recipeId}`;
}

export function incomingDish(dishId: string): string {
  return `dish:${dishId}`;
}

/**
 * Состав пришедшего блюда строками калькулятора.
 *
 * Рецепт и своё блюдо хранят состав ссылками на продукты (`product_id` +
 * граммы), а расчёт требует значений на 100 г — их и дочитываем. Ключи запросов
 * те же, что у карточки рецепта и справочника: открытое рядом берётся из кеша,
 * а не запрашивается второй раз.
 */
export function useIncomingComposition(
  incoming: Incoming | null,
  patientId: string,
): {
  rows: DishRow[] | null;
  isPending: boolean;
  isError: boolean;
} {
  const recipe = useQuery({
    queryKey: ["recipes", "detail", incoming?.id],
    enabled: incoming?.kind === "recipe",
    retry: false,
    queryFn: async (): Promise<Recipe> => {
      const { data, error } = await api.GET("/api/v1/recipes/{recipe_id}", {
        params: { path: { recipe_id: incoming?.id as string } },
      });
      if (error || !data) throw error ?? new Error("Empty recipe response");
      return data;
    },
  });

  // Своё блюдо читается списком, а не по одному: ручки чтения одной раскладки
  // в API нет (раздел 5.3 ТЗ описывает список и правку), а список у экрана
  // «Мои блюда» уже в кеше под тем же ключом.
  const dishes = useCustomDishes(incoming?.kind === "dish" ? patientId : null);
  const dish = {
    data: (dishes.data ?? []).find(
      (item: CustomDish) => item.id === incoming?.id,
    ),
    isError: dishes.isError,
    isPending: dishes.isPending,
  };

  const composition =
    incoming?.kind === "recipe"
      ? (recipe.data?.ingredients ?? null)
      : incoming?.kind === "dish"
        ? (dish.data?.ingredients ?? null)
        : null;

  const products = useQueries({
    queries: (composition ?? []).map((line) => ({
      queryKey: ["products", "one", line.product_id],
      retry: false,
      queryFn: async (): Promise<ProductOption> => {
        const { data, error } = await api.GET("/api/v1/products/{product_id}", {
          params: { path: { product_id: line.product_id } },
        });
        if (error || !data) throw error ?? new Error("Empty product response");
        return {
          id: data.id,
          name: data.name_ru,
          kcal: data.kcal_100g,
          fat: data.fat_100g,
          protein: data.protein_100g,
          carbs: data.carbs_100g,
          fiber: data.fiber_100g,
          isActive: data.is_active,
        };
      },
    })),
  });

  const source = incoming?.kind === "recipe" ? recipe : dish;
  const productsPending = products.some((query) => query.isPending);
  const productsFailed = products.some((query) => query.isError);

  if (incoming === null || incoming.kind === "product") {
    return { rows: null, isPending: false, isError: false };
  }

  if (source.isError || productsFailed) {
    return { rows: null, isPending: false, isError: true };
  }

  if (composition === null || productsPending) {
    // Блюдо есть, состав ещё не дочитан — либо блюда с таким идентификатором в
    // списке нет вовсе; второе разбирается ниже, когда список уже загружен.
    if (
      incoming.kind === "dish" &&
      !dish.isPending &&
      dish.data === undefined
    ) {
      return { rows: null, isPending: false, isError: true };
    }
    return { rows: null, isPending: true, isError: false };
  }

  const byId = new Map(
    products
      .map((query) => query.data)
      .filter((product): product is ProductOption => product !== undefined)
      .map((product) => [product.id, product]),
  );

  const rows = composition
    .map((line) => {
      const product = byId.get(line.product_id);
      return product === undefined ? null : { product, grams: line.grams };
    })
    .filter((row): row is DishRow => row !== null);

  return { rows, isPending: false, isError: false };
}
