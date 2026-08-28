import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

/**
 * Пациенты, доступные текущему пользователю.
 *
 * Область видимости определяет сервер (связи + patient_scope), клиент её не
 * сужает и не расширяет: фронтовые проверки — это UX, не безопасность.
 */
export function usePatients() {
  return useQuery({
    queryKey: ["patients"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/patients", {
        params: { query: { limit: 200, offset: 0 } },
      });
      if (error || !data) throw error ?? new Error("Empty patients response");
      return data;
    },
  });
}
