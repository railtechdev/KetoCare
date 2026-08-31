import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { toAuditQuery, type AuditFilters } from "./auditFilters";

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
