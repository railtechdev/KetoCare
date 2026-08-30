import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

export interface ProductOption {
  id: string;
  name: string;
  kcal: number;
  fat: number;
  protein: number;
  carbs: number;
  fiber: number;
}

/**
 * Поиск продуктов для автодополнения (раздел 8.3 ТЗ).
 *
 * Ниже двух символов запрос не отправляется: по одной букве выдача бесполезна,
 * а нагрузка на полнотекстовый индекс лишняя.
 */
export function useProductSearch(query: string) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: ["products", "search", trimmed],
    enabled: trimmed.length >= 2,
    // Прошлая выдача остаётся на экране, пока грузится новая: без этого список
    // мигает пустотой на каждой набранной букве.
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ProductOption[]> => {
      const { data, error } = await api.GET("/api/v1/products", {
        params: { query: { q: trimmed, limit: 20, offset: 0 } },
      });
      if (error || !data) throw error ?? new Error("Empty products response");

      return data.items.map((item) => ({
        id: item.id,
        name: item.name_ru,
        kcal: item.kcal_100g,
        fat: item.fat_100g,
        protein: item.protein_100g,
        carbs: item.carbs_100g,
        fiber: item.fiber_100g,
      }));
    },
  });
}

/**
 * Один продукт по идентификатору.
 *
 * Нужен, когда продукт выбран не поиском, а приходом из справочника
 * (`/app/calculator?item=<id>`): справочник знает идентификатор, а состав на
 * 100 г для расчёта — нет.
 *
 * `retry: false` — несуществующий идентификатор из чужой или устаревшей ссылки
 * повтором не оживёт.
 */
export function useProduct(productId: string | undefined) {
  return useQuery({
    queryKey: ["products", "one", productId],
    enabled: productId !== undefined,
    retry: false,
    queryFn: async (): Promise<ProductOption> => {
      const { data, error } = await api.GET("/api/v1/products/{product_id}", {
        params: { path: { product_id: productId as string } },
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
      };
    },
  });
}
