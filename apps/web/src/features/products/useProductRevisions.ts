import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
// Верхняя граница страницы объявлена один раз: второе объявление однажды
// разошлось бы с серверным, и запрос стал бы отклоняться как ошибка валидации.
import { MAX_PAGE_SIZE } from "../admin/types";
import type { ProductRevision } from "./revisionDiff";

/**
 * История изменений позиции справочника.
 *
 * Ручка закрыта ролями (`_HISTORY_ROLES` в `routers/products.py`): содержимое
 * справочника открыто всем, а имена сотрудников рядом с правками — сведения о
 * работе клиники. Семье компонент и не показывается.
 */
export function useProductRevisions(productId: string) {
  return useQuery({
    queryKey: ["products", "revisions", productId],
    queryFn: async (): Promise<{ items: ProductRevision[]; total: number }> => {
      const { data, error } = await api.GET(
        "/api/v1/products/{product_id}/revisions",
        {
          params: {
            path: { product_id: productId },
            query: { limit: MAX_PAGE_SIZE, offset: 0 },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty revisions response");
      return data;
    },
  });
}
