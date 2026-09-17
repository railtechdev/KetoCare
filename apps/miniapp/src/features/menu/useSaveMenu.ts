import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { DayItem } from "./dayPlan";
import { menuKey } from "./useMenu";

/**
 * Сохранение состава дня (`PUT`, раздел 5.3 ТЗ).
 *
 * Итоги дня клиент не считает и не присылает: их считает расчётное ядро по
 * составу. Второй источник клинических чисел в браузере — ровно то, чего
 * правило 2 CLAUDE.md не допускает.
 *
 * Пустой день отправлять нечем: схема требует хотя бы одну позицию, а «убрать
 * план целиком» — отдельная ручка `DELETE`. Поэтому удаление последней позиции
 * идёт через неё, и вызывающий об этом знает.
 */
export function useSaveMenu(patientId: string, day: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (items: DayItem[]) => {
      if (items.length === 0) {
        const { error } = await api.DELETE(
          "/api/v1/patients/{patient_id}/menus",
          {
            params: { path: { patient_id: patientId }, query: { date: day } },
          },
        );
        if (error) throw error;
        return null;
      }

      const { data, error } = await api.PUT(
        "/api/v1/patients/{patient_id}/menus",
        {
          params: { path: { patient_id: patientId } },
          body: { date: day, items },
        },
      );
      if (error || !data) throw error ?? new Error("Empty menu response");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: menuKey(patientId, day) });
      // Сводка на главной показывает итоги дня и вердикт о допуске — они
      // производны от состава, и без обновления главная осталась бы с числами
      // прежнего плана.
      void queryClient.invalidateQueries({
        queryKey: ["patient", patientId, "overview"],
      });
    },
  });
}
