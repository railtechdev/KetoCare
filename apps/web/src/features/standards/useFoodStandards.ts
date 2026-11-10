import type { components } from "@ketocare/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";

export type FoodStandard = components["schemas"]["FoodStandardRead"];
export type FoodStandardCreateBody =
  components["schemas"]["FoodStandardCreate"];
export type FoodStandardUpdateBody =
  components["schemas"]["FoodStandardUpdate"];

/**
 * Постоянный идентификатор основного стандарта клиники
 * (`DEFAULT_FOOD_STANDARD_ID` в `core.models`). В адрес он не пишется: ссылка
 * без `?standard=` и означает основной стандарт.
 */
export const DEFAULT_FOOD_STANDARD_ID = "00000000-0000-7000-8000-000000000001";

/**
 * Все стандарты, включая снятые с оборота.
 *
 * Снятые нужны и экрану стандартов, и карточке продукта: по стандарту записи
 * определяется, можно ли её править, а запись остаётся в блюдах и после снятия.
 *
 * Ключ начинается с `['products']`: правка продукта меняет счётчики стандартов,
 * и сброс справочника обязан задевать и их.
 */
export function useFoodStandards() {
  return useQuery({
    queryKey: ["products", "standards"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/v1/food-standards", {
        params: { query: { include_inactive: true } },
      });
      if (error || !data) throw error ?? new Error("Empty standards response");
      return data;
    },
  });
}

function useStandardsInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };
}

export function useCreateStandardMutation() {
  const invalidate = useStandardsInvalidation();

  return useMutation({
    mutationFn: async (body: FoodStandardCreateBody) => {
      const { data, error } = await api.POST("/api/v1/food-standards", {
        body,
      });
      if (error || !data) throw error ?? new Error("Empty standard response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateStandardMutation(standardId: string) {
  const invalidate = useStandardsInvalidation();

  return useMutation({
    mutationFn: async (body: FoodStandardUpdateBody) => {
      const { data, error } = await api.PUT(
        "/api/v1/food-standards/{standard_id}",
        { params: { path: { standard_id: standardId } }, body },
      );
      if (error || !data) throw error ?? new Error("Empty standard response");
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useLockStandardMutation() {
  const invalidate = useStandardsInvalidation();

  return useMutation({
    mutationFn: async (standardId: string) => {
      const { data, error } = await api.POST(
        "/api/v1/food-standards/{standard_id}/lock",
        { params: { path: { standard_id: standardId } } },
      );
      if (error || !data) throw error ?? new Error("Empty standard response");
      return data;
    },
    onSuccess: invalidate,
  });
}
