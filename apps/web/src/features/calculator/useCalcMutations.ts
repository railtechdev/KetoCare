import { useMutation } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { toCalcIngredients, toCalcItems, type DishRow } from "./types";

export interface TargetsInput {
  ratio: number;
  kcal: number;
  proteinMin?: number | null;
  carbsMax?: number | null;
}

function targetsBody(targets: TargetsInput) {
  return {
    ratio: targets.ratio,
    kcal: targets.kcal,
    protein_min_g: targets.proteinMin ?? null,
    carbs_max_g: targets.carbsMax ?? null,
    net_carbs: false,
  };
}

export function useVerifyMutation() {
  return useMutation({
    mutationFn: async (input: {
      rows: DishRow[];
      targets?: TargetsInput;
      // Чей расчёт: по нему сервер называет продукты, исключённые ребёнку.
      // Состав при этом не меняется — его задал человек.
      patientId?: string;
    }) => {
      const { data, error } = await api.POST("/api/v1/calc/verify", {
        body: {
          ingredients: toCalcIngredients(input.rows),
          items: toCalcItems(input.rows),
          targets: input.targets ? targetsBody(input.targets) : null,
          patient_id: input.patientId ?? null,
        },
      });
      if (error || !data) throw error ?? new Error("Empty verify response");
      return data;
    },
  });
}

export function useSolveMutation() {
  return useMutation({
    mutationFn: async (input: {
      rows: DishRow[];
      targets: TargetsInput;
      // Здесь важнее, чем в проверке: подбор сам выбирает, из чего составить
      // блюдо, и исключённые продукты сервер снимает со входа.
      patientId?: string;
    }) => {
      const { data, error } = await api.POST("/api/v1/calc/solve", {
        body: {
          ingredients: toCalcIngredients(input.rows),
          targets: targetsBody(input.targets),
          patient_id: input.patientId ?? null,
        },
      });
      if (error || !data) throw error ?? new Error("Empty solve response");
      return data;
    },
  });
}

export function useScaleMutation() {
  return useMutation({
    mutationFn: async (input: { rows: DishRow[]; factor: number }) => {
      const { data, error } = await api.POST("/api/v1/calc/scale", {
        body: {
          ingredients: toCalcIngredients(input.rows),
          items: toCalcItems(input.rows),
          factor: input.factor,
        },
      });
      if (error || !data) throw error ?? new Error("Empty scale response");
      return data;
    },
  });
}

export function useSaveDishMutation(patientId: string | null) {
  return useMutation({
    mutationFn: async (input: { title: string; rows: DishRow[] }) => {
      if (patientId === null)
        throw new Error("patientId is required to save a dish");

      const { data, error } = await api.POST(
        "/api/v1/patients/{patient_id}/custom-dishes",
        {
          params: { path: { patient_id: patientId } },
          body: {
            title: input.title,
            // Сервер пересчитывает состав сам по product_id: клиентские
            // макронутриенты для сохранения не принимаются.
            ingredients: input.rows.map((row) => ({
              product_id: row.product.id,
              grams: row.grams,
            })),
          },
        },
      );
      if (error || !data) throw error ?? new Error("Empty save response");
      return data;
    },
  });
}
