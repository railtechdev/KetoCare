import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@ketocare/api-client";

import { api } from "../../lib/api";

export type CustomDish = components["schemas"]["CustomDishRead"];

export function customDishesKey(patientId: string) {
  return ["patient", patientId, "custom-dishes"] as const;
}

/**
 * Свои блюда ребёнка (раздел 5.3 ТЗ).
 *
 * Форма сохранения обещала: «Блюдо появится в списке ваших блюд». Списка не
 * существовало ни одним экраном: блюдо с ошибкой в составе или названии
 * оставалось в подсказках меню навсегда, а посмотреть, что в нём, было нельзя
 * нигде.
 */
export function useCustomDishes(patientId: string | null) {
  return useQuery({
    queryKey: customDishesKey(patientId ?? "none"),
    enabled: patientId !== null,
    queryFn: async (): Promise<CustomDish[]> => {
      const { data, error } = await api.GET(
        "/api/v1/patients/{patient_id}/custom-dishes",
        {
          params: {
            path: { patient_id: patientId as string },
            query: { limit: 200, offset: 0 },
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty dishes response");
      return data.items;
    },
  });
}

export function useRenameCustomDish(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      dish,
      title,
    }: {
      dish: CustomDish;
      title: string;
    }) => {
      // Состав уходит прежним: ручка принимает блюдо целиком, и отправить одно
      // название значит стереть раскладку. Правка состава — это калькулятор,
      // и она сохраняется отдельным блюдом.
      const { data, error } = await api.PUT(
        "/api/v1/patients/{patient_id}/custom-dishes/{dish_id}",
        {
          params: { path: { patient_id: patientId, dish_id: dish.id } },
          body: { title, ingredients: dish.ingredients },
        },
      );
      if (error || !data) throw error ?? new Error("Empty dish response");
      return data;
    },
    onSuccess: () => invalidate(queryClient, patientId),
  });
}

export function useDeleteCustomDish(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dishId: string) => {
      const { error } = await api.DELETE(
        "/api/v1/patients/{patient_id}/custom-dishes/{dish_id}",
        { params: { path: { patient_id: patientId, dish_id: dishId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(queryClient, patientId),
  });
}

function invalidate(
  queryClient: ReturnType<typeof useQueryClient>,
  patientId: string,
): void {
  // Ключ общий с подсказками при добавлении блюда в меню и с калькулятором:
  // без сброса переименованное блюдо осталось бы там под старым именем.
  void queryClient.invalidateQueries({ queryKey: customDishesKey(patientId) });
}
