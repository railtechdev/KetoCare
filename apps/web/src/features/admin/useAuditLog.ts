import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { toAuditQuery, type AuditFilters } from "./auditFilters";
import { MAX_PAGE_SIZE, PRODUCTS_AUDIT_ENTITY } from "./types";

/**
 * Журнал аудита (раздел 5.3 ТЗ). Только чтение: ручек изменения и удаления у
 * него нет — иначе журнал перестаёт быть доказательством.
 */
export function useAuditLog(
  filters: AuditFilters,
  offset: number,
  enabled: boolean,
) {
  const query = toAuditQuery(filters, offset);

  return useQuery({
    queryKey: ["admin", "audit", "list", query],
    enabled,
    // Страница держится на экране, пока грузится следующая: иначе журнал
    // мигает пустотой на каждом шаге пагинации.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/admin/audit-log", {
        params: { query },
      });
      if (error || !data) throw error ?? new Error("Empty audit log response");
      return data;
    },
  });
}

/**
 * История ревизий позиции справочника продуктов (раздел 8.3 ТЗ).
 *
 * Источник — тот же журнал аудита: `POST/PUT /products` пишут в него `before` и
 * `after` карточки. Отбор делает сервер по `entity_id`; пока этого параметра не
 * было, экран тянул страницу журнала целиком и отбирал строки у себя, то есть
 * история обрывалась там, где кончалась страница.
 */
export function useProductRevisions(productId: string) {
  return useQuery({
    queryKey: ["admin", "audit", "products", productId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/admin/audit-log", {
        params: {
          query: {
            entity: PRODUCTS_AUDIT_ENTITY,
            entity_id: productId,
            limit: MAX_PAGE_SIZE,
            offset: 0,
          },
        },
      });
      if (error || !data) throw error ?? new Error("Empty revisions response");

      return { entries: data.items, total: data.total };
    },
  });
}
