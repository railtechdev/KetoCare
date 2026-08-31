import { useQuery } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type ProductDetail = components["schemas"]["ProductRead"];

/**
 * Продукт целиком по идентификатору.
 *
 * Нужен там, где позиция открыта ссылкой, а не выбором из показанного списка:
 * до этого редактор искал её среди загруженной страницы и на «не нашёл»
 * открывал форму заведения новой — то есть по ссылке на существующий продукт
 * администратор видел пустую форму «Новый продукт» и мог завести дубль.
 *
 * `retry: false` — несуществующий идентификатор из чужой или устаревшей ссылки
 * повтором не оживёт.
 */
export function useProductDetail(productId: string | null) {
  return useQuery({
    queryKey: ["products", "detail", productId],
    enabled: productId !== null,
    retry: false,
    queryFn: async (): Promise<ProductDetail> => {
      const { data, error } = await api.GET("/api/v1/products/{product_id}", {
        params: { path: { product_id: productId as string } },
      });
      if (error || !data) throw error ?? new Error("Empty product response");
      return data;
    },
  });
}
