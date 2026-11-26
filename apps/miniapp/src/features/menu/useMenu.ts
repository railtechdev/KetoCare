import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api, errorCodeOf } from "../../lib/api";
import { haptic } from "../../lib/telegram";

export type Menu = components["schemas"]["MenuRead"];
export type MenuItem = components["schemas"]["MenuItemRead"];

/** Сегодняшняя дата в местном поясе, а не в UTC: план дня — про календарь семьи. */
export function today(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Дата со сдвигом от сегодня — в том же местном поясе.
 *
 * Дней у приложения семь, а не календарь (`planDays.ts`): вчера, сегодня и пять
 * дней вперёд. Выбор любой даты — это навигация по календарю на 360 px; в
 * кабинете она уже есть (`features/menu/DayNavigator.tsx`).
 *
 * Сдвиг идёт по календарю (`setDate`), а не на 24 часа: в день перевода часов
 * сутки короче или длиннее, и «плюс 24 часа» попадало бы в тот же день.
 */
export function dayAt(offset: number, now: Date = new Date()): string {
  const shifted = new Date(now.getTime());
  shifted.setDate(shifted.getDate() + offset);
  return today(shifted);
}

/** Завтрашняя дата — частный случай `dayAt`. */
export function tomorrow(now: Date = new Date()): string {
  return dayAt(1, now);
}

export function menuKey(patientId: string, day: string) {
  return ["patient", patientId, "menu", day] as const;
}

export type MenuWeek = components["schemas"]["MenuWeekRead"];

/** Все недели ребёнка — правка любого дня сбрасывает их вместе. */
export function menuWeeksKey(patientId: string) {
  return ["patient", patientId, "menu-week"] as const;
}

/**
 * Семь дней меню одним запросом — тем же `GET …/menus/week`, что сетка недели
 * кабинета. Читают его точки «меню составлено» на полосе дней и «Что купить»
 * (Р3 аудита Mini App 21.11.2026). День сервер отдаёт той же формой, что и
 * `GET …/menus`, — с граммами уже на позицию.
 */
export function useMenuWeek(patientId: string, start: string) {
  return useQuery({
    queryKey: [...menuWeeksKey(patientId), start],
    queryFn: async (): Promise<MenuWeek> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/menus/week",
        { params: { path: { patient_id: patientId }, query: { start } } },
      );
      if (error || !data) throw error ?? new Error("Empty week response");
      return data;
    },
  });
}

/**
 * План питания на день.
 *
 * Меню может не быть — это обычное состояние, а не сбой: семья могла не
 * планировать день. Поэтому 404 превращается в `null`, а не в ошибку экрана.
 */
export function useMenu(
  patientId: string,
  day: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: menuKey(patientId, day),
    enabled,
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
 * Назначение, действующее в этот день (ADR-0078).
 *
 * Завтра может начаться новая версия с другим числом приёмов и другими
 * целями: раскладывать и сверять завтрашний день по сегодняшней сводке нельзя
 * (аудит расчётов 13.11.2026). Правило выбора — на сервере.
 */
export function useDayPrescription(patientId: string, day: string) {
  return useQuery({
    queryKey: ["prescription-on", patientId, day],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/prescriptions/on",
        { params: { path: { patient_id: patientId }, query: { date: day } } },
      );
      if (error || !data) {
        throw error ?? new Error("Empty day prescription response");
      }
      return data.prescription ?? null;
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
      // Отмечают на ходу, не глядя в экран: толчок говорит «принято».
      haptic("success");
      void queryClient.invalidateQueries({ queryKey: menuKey(patientId, day) });
      void queryClient.invalidateQueries({
        queryKey: ["patient", patientId, "overview"],
      });
    },
    // Позиции больше нет: план дня в ту же минуту пересохранили без неё (409
    // `plan_changed`, Н10) или убрали раньше (404). Экран перечитывает день —
    // иначе семья снова и снова отмечала бы блюдо, которого в плане нет.
    onError: (error) => {
      haptic("error");
      const code = errorCodeOf(error);
      if (code === "conflict" || code === "not_found") {
        void queryClient.invalidateQueries({
          queryKey: menuKey(patientId, day),
        });
      }
    },
  });
}

/**
 * Взять в позицию дня состав блюда таким, какой он сейчас (ADR-0089).
 *
 * Ответ — день целиком: он кладётся в кэш сразу, чтобы «Что взвесить» показало
 * новые граммы без ещё одного запроса. Сводка перечитывается: итоги дня
 * поменялись вместе с составом.
 */
export function useRefreshItem(patientId: string, day: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/menus/items/{item_id}/refresh",
        { params: { path: { patient_id: patientId, item_id: itemId } } },
      );
      if (error || !data) throw error ?? new Error("Empty menu response");
      return data;
    },
    onSuccess: (menu) => {
      haptic("success");
      queryClient.setQueryData(menuKey(patientId, day), menu);
      void queryClient.invalidateQueries({
        queryKey: ["patient", patientId, "overview"],
      });
    },
  });
}

/** Отметку отвергли потому, что план дня изменился, — сказать это над планом. */
export function isPlanChanged(error: unknown): boolean {
  return errorCodeOf(error) === "conflict";
}
