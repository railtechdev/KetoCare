import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";

/**
 * Телефон клиники для семьи — из бланка клиники (ADR-0092), если
 * администратор его указал. Под отказом помощника и в «кто именно» («о срочном
 * звоните в клинику» без номера отсылало туда, куда семье нечем дозвониться),
 * а с этапа 4 аудита Mini App (Р4) — и на «Сегодня», и в настройках: у семьи
 * из Telegram кабинета нет, и номера клиники ей больше негде взять.
 *
 * Не пришёл бланк — номера просто нет: строка «звоните в клинику» остаётся,
 * ссылки не появляется. Повторять запрос ради необязательной строки незачем.
 */
export function useClinicPhone(): string | null {
  const letterhead = useQuery({
    queryKey: ["letterhead"],
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/letterhead");
      if (error || !data) throw error ?? new Error("Empty letterhead");
      return data;
    },
  });
  const phone = letterhead.data?.text?.family_phone?.trim();
  return phone ? phone : null;
}
