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
  /**
   * Продукт в обороте.
   *
   * Поиск выведенные не отдаёт, но в состав продукт попадает и другим путём —
   * приходом из справочника (`?item=`), где редактору видны все. Считать по
   * нему не запрещено (история должна считаться), а вот молчать об этом
   * нельзя: выводят продукт обычно потому, что его числа оказались неверными.
   */
  isActive: boolean;
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
        isActive: item.is_active,
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
        isActive: data.is_active,
      };
    },
  });
}

/**
 * Продукты, которые семья уже клала в дни ребёнка.
 *
 * Подсказка для пустого поля (правило П11 канона): поиск молчит, пока не
 * набраны два символа, а семья изо дня в день кладёт в меню одни и те же
 * двадцать продуктов. Источник — снимки уже составленных дней, то есть ровно
 * то, что она действительно использовала.
 */
export function useRecentProducts(patientId: string | undefined) {
  return useQuery({
    queryKey: ["patient", patientId, "recent-products"],
    enabled: patientId !== undefined,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ProductOption[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/menus/recent-products",
        { params: { path: { patient_id: patientId as string } } },
      );
      if (error || !data) throw error ?? new Error("Empty recent response");

      return data.map((item) => ({
        id: item.id,
        name: item.name_ru,
        kcal: item.kcal_100g,
        fat: item.fat_100g,
        protein: item.protein_100g,
        carbs: item.carbs_100g,
        fiber: item.fiber_100g,
        isActive: item.is_active,
      }));
    },
  });
}
