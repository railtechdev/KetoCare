import { useDebouncedValue } from "@ketocare/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { ProductAnomaly } from "./productAnomalyText";

/** Пауза после правки числа, прежде чем спросить сервер, мс. */
const CHECK_DELAY_MS = 400;

export interface ProductValues {
  kcal: number;
  fat: number;
  protein: number;
  carbs: number;
  fiber: number;
}

function isComplete(values: ProductValues): boolean {
  return Object.values(values).every(
    (value) => Number.isFinite(value) && value >= 0,
  );
}

/**
 * Находки по значениям карточки продукта — по мере ввода, до сохранения.
 *
 * Ответ клиники от 09.09.2026 на вопрос 1: калорийность, расходящуюся с
 * 9 — 4 — 4 больше чем на 5 ккал, «нужно предупреждать». Считает сервер
 * (`POST /products/check`) тем же модулем, что список подозрительных:
 * коэффициенты — медицинская константа ядра, и копии в браузере нет.
 *
 * Незаполненные поля сервер не спрашивает: судить о половине карточки нечего.
 */
export function useProductValuesCheck(values: ProductValues) {
  const settled = useDebouncedValue(values, CHECK_DELAY_MS);
  const complete = isComplete(settled);

  return useQuery({
    queryKey: ["products", "check", settled],
    enabled: complete,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ProductAnomaly[]> => {
      const { data, error } = await api.POST("/api/v1/products/check", {
        body: {
          kcal_100g: settled.kcal,
          fat_100g: settled.fat,
          protein_100g: settled.protein,
          carbs_100g: settled.carbs,
          fiber_100g: settled.fiber,
        },
      });
      if (error || !data) throw error ?? new Error("Empty check response");
      return data;
    },
  });
}
