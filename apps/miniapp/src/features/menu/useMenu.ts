import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type Menu = components["schemas"]["MenuRead"];
export type MenuItem = components["schemas"]["MenuItemRead"];

/** Сегодняшняя дата в местном поясе, а не в UTC: план дня — про календарь семьи. */
export function today(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function menuKey(patientId: string, day: string) {
  return ["patient", patientId, "menu", day] as const;
}

/**
 * План питания на день.
 *
 * Меню может не быть — это обычное состояние, а не сбой: семья могла не
 * планировать день. Поэтому 404 превращается в `null`, а не в ошибку экрана.
 */
export function useMenu(patientId: string, day: string) {
  return useQuery({
    queryKey: menuKey(patientId, day),
    queryFn: async (): Promise<Menu | null> => {
      const { data, error, response } = await api.GET(
        "/api/v1/patients/{patient_id}/menus",
        { params: { path: { patient_id: patientId }, query: { date: day } } },
      );
      if (response.status === 404) return null;
      if (error || !data) throw error ?? new Error("Empty menu response");
      return data;
    },
  });
}

/**
 * Отметка «съедено» — и снятие её тоже.
 *
 * Снятие нужно так же, как простановка: ошибочное нажатие иначе осталось бы в
 * данных навсегда, а по этим отметкам врач судит, выполнялся ли план.
 */
export function useMarkEaten(patientId: string, day: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      itemId,
      eaten,
    }: {
      itemId: string;
      eaten: boolean;
    }) => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/menus/items/{item_id}/eaten",
        {
          params: { path: { patient_id: patientId, item_id: itemId } },
          body: { eaten },
        },
      );
      if (error || !data) throw error ?? new Error("Empty eaten response");
      return data;
    },
    // Итоги дня и сводка на главной зависят от отметок, поэтому обновляется и
    // то, и другое: иначе главная показывала бы вчерашнюю картину дня.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: menuKey(patientId, day) });
      void queryClient.invalidateQueries({
        queryKey: ["patient", patientId, "overview"],
      });
    },
  });
}
