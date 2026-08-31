import type { components } from "@ketocare/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, errorCodeOf } from "../../lib/api";
import type { DayTolerance } from "../patients/dayVerdict";
import { patientOverviewKey, patientOverviewQuery } from "../patients/overview";

export type MealSlot = components["schemas"]["MealSlot"];
export type MenuRead = components["schemas"]["MenuRead"];
export type MenuItemRead = components["schemas"]["MenuItemRead"];
export type MenuItemWrite = components["schemas"]["MenuItemWrite"];
export type DayTotals = components["schemas"]["DishComputed"];

/** Источник позиции меню: рецепт из общей базы или своё блюдо пациента. */
export type DishKind = "recipe" | "custom";

/** Приёмы пищи в порядке дня (раздел 4.2 ТЗ, `menu_items.meal_slot`). */
export const MEAL_SLOTS: readonly MealSlot[] = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
];

/** Ключи запросов иерархией (раздел 8.4 ТЗ): день лежит под пациентом. */
export function menuKey(patientId: string | null, date: string) {
  return ["patient", patientId, "menu", date] as const;
}

export function menusKey(patientId: string | null) {
  return ["patient", patientId, "menu"] as const;
}

/**
 * Меню на дату. `null` — дня ещё нет.
 *
 * Отсутствие меню сервер отдаёт как 404, но для экрана это не ошибка, а обычное
 * состояние: семья день ещё не составила. Показывать вместо пустого дня
 * сообщение об ошибке значило бы пугать родителя на ровном месте.
 */
export function useMenuQuery(patientId: string | null, date: string) {
  return useQuery({
    queryKey: menuKey(patientId, date),
    enabled: patientId !== null,
    queryFn: async (): Promise<MenuRead | null> => {
      if (patientId === null) throw new Error("patientId is required");

      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/menus",
        { params: { path: { patient_id: patientId }, query: { date } } },
      );
      if (error) {
        if (errorCodeOf(error) === "not_found") return null;
        throw error;
      }
      return data ?? null;
    },
  });
}

/**
 * Сохранение дня целиком (PUT — upsert, раздел 5.3 ТЗ).
 *
 * Итоги дня считает ядро на сервере и возвращает в ответе, поэтому клиент их
 * не складывает: кетосоотношение не аддитивно, сумма показателей блюд не даёт
 * показателей дня.
 */
export function useUpsertMenuMutation(patientId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { date: string; items: MenuItemWrite[] }) => {
      if (patientId === null)
        throw new Error("patientId is required to save a menu");

      const { data, error } = await api.PUT(
        "/api/v1/patients/{patient_id}/menus",
        {
          params: { path: { patient_id: patientId } },
          body: { date: input.date, items: input.items },
        },
      );
      if (error || !data) throw error ?? new Error("Empty menu response");
      return data;
    },
    onSuccess: (menu) => onMenuSaved(queryClient, patientId, menu),
  });
}

/**
 * Копирование дня: состав другой даты сохраняется на выбранную.
 *
 * Состав берётся с сервера, а не из кэша: скопировать можно и день, который на
 * этом экране ни разу не открывали.
 */
export function useCopyDayMutation(patientId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { from: string; to: string }) => {
      if (patientId === null)
        throw new Error("patientId is required to copy a menu");

      const source = await api.GET("/api/v1/patients/{patient_id}/menus", {
        params: {
          path: { patient_id: patientId },
          query: { date: input.from },
        },
      });
      // Ошибку источника пробрасываем как есть: «Меню на эту дату не
      // составлено» сервер уже написал по-русски (раздел 5.1 ТЗ).
      if (source.error) throw source.error;
      if (!source.data) throw new Error("Empty source menu response");

      const items = toWriteItems(source.data.items);
      if (items.length === 0) throw new Error("Source menu has no items");

      const { data, error } = await api.PUT(
        "/api/v1/patients/{patient_id}/menus",
        {
          params: { path: { patient_id: patientId } },
          body: { date: input.to, items },
        },
      );
      if (error || !data) throw error ?? new Error("Empty menu response");
      return data;
    },
    onSuccess: (menu) => onMenuSaved(queryClient, patientId, menu),
  });
}

/**
 * Отметка «съедено» с оптимистичным апдейтом.
 *
 * Раздел 8.4 ТЗ разрешает оптимистичные апдейты только для этих чекбоксов:
 * флаг ни на что не влияет, кроме самого себя (итоги дня описывают план), и
 * при ошибке состояние возвращается к прежнему.
 */
export function useEatenMutation(patientId: string | null, date: string) {
  const queryClient = useQueryClient();
  const key = menuKey(patientId, date);

  return useMutation({
    mutationFn: async (input: { itemId: string; eaten: boolean }) => {
      if (patientId === null)
        throw new Error("patientId is required to mark an item eaten");

      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/menus/items/{item_id}/eaten",
        {
          params: {
            path: { patient_id: patientId, item_id: input.itemId },
          },
          body: { eaten: input.eaten },
        },
      );
      if (error || !data) throw error ?? new Error("Empty eaten response");
      return data;
    },
    onMutate: async (input) => {
      // Незавершённая загрузка дня перезаписала бы отметку старым ответом.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MenuRead | null>(key);

      queryClient.setQueryData<MenuRead | null>(key, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === input.itemId
                  ? { ...item, eaten: input.eaten }
                  : item,
              ),
            }
          : current,
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      // Без отката галочка осталась бы стоять при незаписанной отметке, и семья
      // считала бы приём отмеченным.
      if (context) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Вердикт о соответствии итогов дня назначению — только от сервера.
 *
 * Допуски (`RATIO_TOLERANCE`, `KCAL_TOLERANCE`) — медицинские константы ядра, их
 * копия в TypeScript со временем разошлась бы с расчётом, и экран показывал бы
 * «в норме» там, где ядро считает иначе (правило 2 CLAUDE.md).
 *
 * Готовый вердикт отдаёт только `/patients/{id}/overview`, и только за
 * сегодняшний день в часовом поясе установки: `GET /menus` возвращает итоги без
 * него. Поэтому для прочих дат вердикта нет, и показатели выводятся нейтрально.
 *
 * Отдаётся ответ сервера как есть: своя форма вердикта была бы четвёртой копией
 * одного и того же, а как его показывать — решает `patients/dayVerdict`.
 */
export function useDayTolerance(
  patientId: string | null,
  date: string,
): DayTolerance | null {
  const overview = useQuery(patientOverviewQuery(patientId));

  const tolerance = overview.data?.day?.tolerance;

  // Пока сводка перезагружается после правки меню, вердикт относится к прежнему
  // составу дня: лучше не показывать соответствие, чем показать чужое.
  if (overview.isFetching || overview.data?.date !== date || !tolerance) {
    return null;
  }

  return tolerance;
}

/** Нормы назначения на день: с ними итоги показывают, сколько осталось. */
export interface DayTargets {
  kcalPerDay: number;
  carbsLimitG: number;
  /**
   * Сколько приёмов пищи в день назначил врач.
   *
   * Поле назначения существует с первой миграции, врач его заполняет — и до
   * сих пор оно не доходило ни до одного экрана семьи. Семья планировала день
   * по четырём слотам, не зная, что назначено пять приёмов.
   */
  mealsPerDay: number;
}

/**
 * Нормы дня для показа остатка «осталось до цели» (правило П18 UI-канона).
 *
 * Источник тот же, что у вердикта, — сводка пациента, и ограничение то же:
 * сводка относится к сегодняшнему дню в часовом поясе установки. Для прочих
 * дат остаток не показывается: назначение append-only, и вычитать сегодняшнюю
 * норму из состава прошлой даты значило бы сравнивать день с нормой, которая
 * тогда могла быть другой.
 */
export function useDayTargets(
  patientId: string | null,
  date: string,
): DayTargets | null {
  const overview = useQuery(patientOverviewQuery(patientId));

  const prescription = overview.data?.prescription;

  if (overview.data?.date !== date || !prescription) return null;

  return {
    kcalPerDay: prescription.kcal_per_day,
    carbsLimitG: prescription.carbs_limit_g,
    mealsPerDay: prescription.meals_per_day,
  };
}

/**
 * Новая позиция плана.
 *
 * Ссылка ровно одна: позицию с обеими сразу непонятно как считать, и сервер
 * такую отклоняет (раздел 4.2 ТЗ). Выбор источника один — `kind`, поэтому
 * состояние «выбраны оба» на экране невозможно в принципе.
 */
export function toWriteItem(input: {
  slot: MealSlot;
  kind: DishKind;
  id: string;
  portionFactor: number;
}): MenuItemWrite {
  return {
    meal_slot: input.slot,
    recipe_id: input.kind === "recipe" ? input.id : null,
    custom_dish_id: input.kind === "custom" ? input.id : null,
    portion_factor: input.portionFactor,
  };
}

/** Состав дня в формате записи: PUT задаёт весь день, а не отдельные позиции. */
export function toWriteItems(
  items: readonly MenuItemRead[] | undefined,
): MenuItemWrite[] {
  return (items ?? []).map((item) => ({
    meal_slot: item.meal_slot,
    recipe_id: item.recipe_id,
    custom_dish_id: item.custom_dish_id,
    portion_factor: item.portion_factor,
  }));
}

function onMenuSaved(
  queryClient: ReturnType<typeof useQueryClient>,
  patientId: string | null,
  menu: MenuRead,
): void {
  // Ответ PUT — это и есть новое состояние дня с пересчитанными итогами:
  // кладём его в кэш, чтобы итоги обновились сразу, не дожидаясь перезагрузки.
  queryClient.setQueryData(menuKey(patientId, menu.date), menu);
  void queryClient.invalidateQueries({ queryKey: menusKey(patientId) });
  // Итоги дня показывает и главная — её сводка тоже устарела.
  void queryClient.invalidateQueries({
    queryKey: patientOverviewKey(patientId),
  });
}
